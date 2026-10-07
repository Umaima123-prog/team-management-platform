"""Service entrypoint.

Runs four concurrent pieces in one process/event loop:
1. The liveness/readiness/consumer-state HTTP app (health_app.py), via
   uvicorn's asyncio server API (not its own blocking `uvicorn.run`,
   so it can share the loop with the pieces below).
2. The durable JetStream consumer loop (messaging/consumer.py),
   projecting events into insights_db.
3. The Core NATS request/reply insights responder
   (messaging/responder.py).
4. The Core NATS request/reply activity responder
   (messaging/activity_responder.py, Phase 6).

Any one of these failing to start (e.g. NATS unreachable) logs and lets
the others continue - consistent with this project's existing
"infrastructure setup is not a liveness dependency" stance
(docs/ARCHITECTURE.md "Health model"; docs/DECISIONS.md #13).
"""

from __future__ import annotations

import asyncio
import logging

import uvicorn
from nats.aio.client import Client as NatsClient
from nats.js import JetStreamContext

from .config import get_settings
from .consumer_state import ConsumerStateRepository
from .db import database_from_client, get_client
from .health_app import app, consumer_state_view
from .index_bootstrap import bootstrap_indexes
from .logging_config import configure_logging
from .messaging.activity_responder import ActivityResponder
from .messaging.consumer import EventConsumer
from .messaging.processor import EventProcessor
from .messaging.responder import InsightsResponder
from .nats_client import connect
from .projections.activity import ActivityProjectionRepository
from .projections.state import ItemStateRepository
from .projections.workload import WorkloadProjectionRepository

logger = logging.getLogger(__name__)


async def run() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    logger.info(
        "activity-insights-service starting (env=%s, db=%s, durable_consumer=%s)",
        settings.environment,
        settings.mongodb_db_name,
        settings.nats_durable_consumer_name,
    )

    # One client for the whole process: a Mongo session is only valid
    # against the exact client that created it, so the db handle used
    # for collections and the client used for start_session() must be
    # the same instance (see db.py's database_from_client docstring).
    client = get_client(settings)
    db = database_from_client(client, settings)
    await bootstrap_indexes(db)

    stop_event = asyncio.Event()
    tasks: list[asyncio.Task] = []

    server_config = uvicorn.Config(
        app,
        host="0.0.0.0",  # noqa: S104 - local/dev container port, not internet-facing
        port=settings.health_port,
        log_level=settings.log_level.lower(),
    )
    server = uvicorn.Server(server_config)
    tasks.append(asyncio.create_task(server.serve(), name="health-http"))

    nc: NatsClient | None
    js: JetStreamContext | None
    try:
        nc, js = await connect(settings)
    except Exception:
        logger.exception(
            "Could not connect to NATS at startup - health HTTP app will still run; "
            "consumer and responder are not started this process lifetime."
        )
        nc, js = None, None

    if js is not None and nc is not None:
        processor = EventProcessor(client, db, consumer_name=settings.nats_durable_consumer_name)
        consumer = EventConsumer(js, processor, consumer_state_view)
        tasks.append(
            asyncio.create_task(consumer.run_forever(stop_event), name="jetstream-consumer")
        )

        responder = InsightsResponder(
            nc,
            WorkloadProjectionRepository(db),
            ActivityProjectionRepository(db),
            ConsumerStateRepository(db),
            consumer_name=settings.nats_durable_consumer_name,
        )
        await responder.start()

        activity_responder = ActivityResponder(
            nc,
            ActivityProjectionRepository(db),
            ConsumerStateRepository(db),
            ItemStateRepository(db),
            consumer_name=settings.nats_durable_consumer_name,
        )
        await activity_responder.start()

    await asyncio.gather(*tasks)


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()

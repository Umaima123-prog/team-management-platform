"""Replay JetStream history into a clean, isolated projection
(assignment: "Support replay into a clean projection without touching
Management Service data").

Deliberately a script, never an HTTP endpoint - the assignment also
says "Do not expose unsafe public replay/admin endpoints", and this
operation needs an operator present to choose a namespace and interpret
the result, not an unauthenticated route:

    python -m activity_insights.replay --namespace replay1_

What it does, concretely:

1. Creates (or reuses, on a second run with the same --consumer-name)
   a brand-new durable JetStream consumer on the real `TEAM_EVENTS`
   stream with `deliver_policy=all` - full history, from the
   beginning. This is a *different* consumer from the assignment-
   mandated `activity-insights-v1` (never touched here - see
   messaging/consumer.py's module docstring) and a different consumer
   from any previous replay run unless --consumer-name is reused on
   purpose.
2. Processes every message through the exact same `EventProcessor`/
   `EventConsumer.handle_message` logic the live service uses (no
   special-cased "replay mode" business logic to drift from
   production behaviour), but with every collection name prefixed by
   `--namespace` (see collections.py / each repository's `namespace`
   parameter) - so it writes to e.g. `replay1_item_state`,
   `replay1_inbox`, etc., never the live `item_state`/`inbox`/...
   collections. Still only ever within `insights_db` - Management
   Service data is never read or written (this script imports nothing
   from, and has no credentials for, management_db).
3. Stops once a fetch times out with nothing pending (caught up to the
   stream's current end) rather than running forever.

Does NOT delete a prior run's namespaced collections first - run with
a fresh --namespace for a guaranteed-clean projection, or drop the old
namespace's collections yourself first if you want to reuse one.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
from dataclasses import dataclass

import nats.js.errors
from nats.js.api import AckPolicy, ConsumerConfig, DeliverPolicy

from .config import get_settings
from .consumer_state import ConsumerStateView
from .db import database_from_client, get_client
from .events.subjects import TEAM_EVENTS_STREAM_NAME
from .index_bootstrap import bootstrap_namespaced_indexes
from .logging_config import configure_logging
from .messaging.consumer import EventConsumer
from .messaging.processor import EventProcessor
from .nats_client import connect

logger = logging.getLogger(__name__)


@dataclass
class ReplaySummary:
    namespace: str
    consumer_name: str
    messages_fetched: int
    last_processed_stream_seq: int | None


async def _ensure_replay_consumer(js, consumer_name: str) -> None:
    try:
        await js.consumer_info(TEAM_EVENTS_STREAM_NAME, consumer_name)
        logger.info("Reusing existing replay consumer %s.", consumer_name)
        return
    except nats.js.errors.NotFoundError:
        pass
    await js.add_consumer(
        TEAM_EVENTS_STREAM_NAME,
        config=ConsumerConfig(
            durable_name=consumer_name,
            ack_policy=AckPolicy.EXPLICIT,
            deliver_policy=DeliverPolicy.ALL,
            max_deliver=5,
        ),
    )
    logger.info("Created new replay consumer %s (deliver_policy=all).", consumer_name)


async def run_replay(
    namespace: str, consumer_name: str, *, idle_timeout_s: float = 5.0
) -> ReplaySummary:
    if not namespace or not namespace.strip():
        raise ValueError("namespace must be a non-empty string, e.g. 'replay1_'")

    settings = get_settings()
    client = get_client(settings)
    db = database_from_client(client, settings)
    await bootstrap_namespaced_indexes(db, namespace)

    nc, js = await connect(settings)
    await _ensure_replay_consumer(js, consumer_name)

    processor = EventProcessor(client, db, consumer_name=consumer_name, namespace=namespace)
    state_view = ConsumerStateView(consumer_name)
    consumer = EventConsumer(
        js,
        processor,
        state_view,
        durable_name=consumer_name,
        fetch_timeout_s=idle_timeout_s,
    )

    sub = await js.pull_subscribe_bind(durable=consumer_name, stream=TEAM_EVENTS_STREAM_NAME)
    fetched = 0
    try:
        while True:
            try:
                msgs = await sub.fetch(10, timeout=idle_timeout_s)
            except TimeoutError:
                # The builtin, not just nats.errors.TimeoutError - see
                # messaging/consumer.py's run_forever for why this
                # specific broadening matters (a real crash found live
                # this phase, docs/DECISIONS.md #27).
                break  # caught up - no more history pending for this consumer
            for msg in msgs:
                await consumer.handle_message(msg)
                fetched += 1
    finally:
        await nc.close()

    snapshot = state_view.snapshot()
    return ReplaySummary(
        namespace=namespace,
        consumer_name=consumer_name,
        messages_fetched=fetched,
        last_processed_stream_seq=snapshot.last_processed_stream_seq,
    )


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Replay TEAM_EVENTS history into a clean, namespaced projection."
    )
    parser.add_argument(
        "--namespace",
        required=True,
        help="Collection-name prefix for this replay's projections, e.g. 'replay1_'. "
        "Never the empty string - that would target the live collections.",
    )
    parser.add_argument(
        "--consumer-name",
        default=None,
        help="Durable consumer name to create/reuse for this replay "
        "(default: 'activity-insights-replay-<namespace>').",
    )
    parser.add_argument(
        "--idle-timeout",
        type=float,
        default=5.0,
        help="Seconds of no new messages before concluding the replay has caught up (default: 5).",
    )
    return parser.parse_args(argv)


def main() -> None:
    args = _parse_args()
    configure_logging(get_settings().log_level)
    consumer_name = args.consumer_name or f"activity-insights-replay-{args.namespace.strip('_')}"
    summary = asyncio.run(
        run_replay(args.namespace, consumer_name, idle_timeout_s=args.idle_timeout)
    )
    print(
        f"Replay complete: namespace={summary.namespace!r} consumer={summary.consumer_name!r} "
        f"messagesFetched={summary.messages_fetched} "
        f"lastProcessedStreamSeq={summary.last_processed_stream_seq}"
    )


if __name__ == "__main__":
    main()

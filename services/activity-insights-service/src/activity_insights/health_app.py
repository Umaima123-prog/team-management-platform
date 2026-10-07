"""Liveness/readiness HTTP app.

Phase 2 surface (`/healthz`, `/readyz`) is unchanged - their response
shapes are a stable contract (see tests/test_health_app.py) and must
keep gating on MongoDB only, never on NATS (docs/DECISIONS.md #13,
mirrored here for the same reason it applies to the Management
Service). `/health/consumer` is new in Phase 5: the durable-consumer
diagnostic the assignment requires (last processed stream sequence,
last successful processing time, freshness/processing age) - reported,
like `/health/ready`'s `messaging` block on the NestJS side, as a
diagnostic that never flips an HTTP status code of its own.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from .config import Settings, get_settings
from .consumer_state import ConsumerStateView
from .db import get_database, ping
from .index_bootstrap import bootstrap_indexes

# Populated by consumer_main.py's run() once the consumer loop starts;
# left as a disconnected, never-processed snapshot in any process that
# never runs the consumer (e.g. a plain health-only process, or a test
# importing this module directly) - see consumer_state.py.
consumer_state_view = ConsumerStateView(get_settings().nats_durable_consumer_name)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # get_database() enforces the insights_db-only guard (see db.py) and
    # is deliberately allowed to raise here: a misconfigured
    # MONGODB_DB_NAME must fail startup loudly, not be swallowed.
    # bootstrap_indexes itself already catches and logs its own
    # (non-fatal) index-creation failures internally.
    settings = get_settings()
    await bootstrap_indexes(get_database(settings))
    yield


app = FastAPI(title="activity-insights-service", lifespan=lifespan)


def get_db(settings: Settings = Depends(get_settings)) -> AsyncIOMotorDatabase:
    return get_database(settings)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    """Liveness: process is up. Never depends on the database."""
    return {"status": "ok", "service": "activity-insights-service"}


@app.get("/readyz")
async def readyz(db: AsyncIOMotorDatabase = Depends(get_db)) -> dict[str, Any]:
    """Readiness: can this instance actually serve traffic right now."""
    healthy = await ping(db)
    if not healthy:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"status": "error", "database": db.name},
        )
    return {"status": "ok", "database": db.name}


@app.get("/health/consumer")
def health_consumer() -> dict[str, Any]:
    """Durable-consumer diagnostic (Phase 5, assignment-required):
    connection state, last processed JetStream stream sequence, last
    successful processing time, and freshness/processing age. Always
    200 - this is a diagnostic, not a readiness gate (see module
    docstring)."""
    snapshot = consumer_state_view.snapshot()
    return {
        "durableConsumerName": snapshot.durable_name,
        "connected": snapshot.connected,
        "lastProcessedStreamSeq": snapshot.last_processed_stream_seq,
        "lastSuccessfulProcessingAt": (
            snapshot.last_success_at.isoformat() if snapshot.last_success_at else None
        ),
        "processingAgeSeconds": snapshot.processing_age_seconds(),
    }

"""Liveness/readiness HTTP app.

This is the only HTTP surface this service exposes in Phase 2 - a
liveness check and a readiness check against insights_db. Event
consumption (JetStream), inbox persistence, projections, and the Core
NATS request/reply query surface are not implemented yet.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from .config import Settings, get_settings
from .db import get_database, ping
from .index_bootstrap import bootstrap_indexes


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

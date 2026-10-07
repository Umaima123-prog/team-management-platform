"""Index bootstrap for insights_db collections.

Applied idempotently at startup (create_indexes no-ops on an existing
identical index) rather than as a separate migration step. Each
collection's index creation is independently try/except'd so one
collection's failure never prevents another's (and never crashes
startup - see health_app.py's lifespan).

Phase 5 required indexes (assignment):
- inbox: unique on (event_id, consumer) - the dedup gate itself.
- activity_projection: (projectId, occurredAt) - project activity
  timelines, ordered.
- workload_projection: projectId - per-project workload queries
  (InsightsResponder).

Phase 2 created a unique single-field index on inbox.event_id before
the "per consumer" requirement existed. It is superseded here (dropped
if present) by the compound (event_id, consumer) index - inbox has
never been written to in production by any prior phase (event
consumption didn't exist yet), so there is no data-migration concern,
only a schema-declaration one.
"""

from __future__ import annotations

import logging

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING, IndexModel

from .collections import (
    ACTIVITY_PROJECTION_COLLECTION,
    INBOX_COLLECTION,
    WORKLOAD_PROJECTION_COLLECTION,
)

logger = logging.getLogger(__name__)

_LEGACY_INBOX_INDEX_NAME = "event_id_unique"


async def _drop_legacy_inbox_index(db: AsyncIOMotorDatabase) -> None:
    try:
        await db[INBOX_COLLECTION].drop_index(_LEGACY_INBOX_INDEX_NAME)
        logger.info("Dropped superseded inbox index %s.", _LEGACY_INBOX_INDEX_NAME)
    except Exception as exc:  # noqa: BLE001 - "does not exist" (OperationFailure, expected
        # on a fresh DB or after this runs once) and genuine connectivity
        # failures (e.g. unreachable Mongo) must both be non-fatal here,
        # same as every create_indexes call below - do not crash startup.
        logger.debug(
            "Skipping legacy inbox index drop (%s): %s", type(exc).__name__, exc
        )


def _index_plans(namespace: str) -> list[tuple[str, list[IndexModel]]]:
    return [
        (
            f"{namespace}{INBOX_COLLECTION}",
            [
                IndexModel(
                    [("event_id", ASCENDING), ("consumer", ASCENDING)],
                    name="event_id_consumer_unique",
                    unique=True,
                )
            ],
        ),
        (
            f"{namespace}{ACTIVITY_PROJECTION_COLLECTION}",
            [
                IndexModel(
                    [("projectId", ASCENDING), ("occurredAt", ASCENDING)],
                    name="project_occurred_idx",
                )
            ],
        ),
        (
            f"{namespace}{WORKLOAD_PROJECTION_COLLECTION}",
            [IndexModel([("projectId", ASCENDING)], name="project_idx")],
        ),
    ]


async def bootstrap_namespaced_indexes(db: AsyncIOMotorDatabase, namespace: str) -> None:
    """Shared by both the live service (namespace="") and replay.py
    (a non-empty namespace prefix) - see collections.py."""
    for collection_name, indexes in _index_plans(namespace):
        try:
            await db[collection_name].create_indexes(indexes)
        except Exception as exc:  # noqa: BLE001 - log and continue, do not crash startup
            logger.warning(
                "Failed to create indexes for %s (%s)", collection_name, type(exc).__name__
            )


async def bootstrap_indexes(db: AsyncIOMotorDatabase) -> None:
    await _drop_legacy_inbox_index(db)
    await bootstrap_namespaced_indexes(db, "")

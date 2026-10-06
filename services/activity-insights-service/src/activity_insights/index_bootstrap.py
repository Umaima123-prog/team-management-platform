"""Index bootstrap for insights_db collections.

Applied idempotently at startup (create_index no-ops on an existing
identical index) rather than as a separate migration step.

Only the inbox's dedup-by-event_id uniqueness is registered today -
that's the correctness invariant the inbox pattern depends on
(docs/ARCHITECTURE.md), independent of which domain events eventually
flow through it. activity_projection, workload_projection, and
processing_failures get their indexes once a later phase defines what
those documents actually look like; registering something speculative
now would just be guessing at a schema that doesn't exist yet.
"""

from __future__ import annotations

import logging

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING, IndexModel

from .collections import INBOX_COLLECTION

logger = logging.getLogger(__name__)


async def bootstrap_indexes(db: AsyncIOMotorDatabase) -> None:
    try:
        await db[INBOX_COLLECTION].create_indexes(
            [IndexModel([("event_id", ASCENDING)], name="event_id_unique", unique=True)]
        )
    except Exception as exc:  # noqa: BLE001 - log and continue, do not crash startup
        logger.warning(
            "Failed to create indexes for %s (%s)", INBOX_COLLECTION, type(exc).__name__
        )

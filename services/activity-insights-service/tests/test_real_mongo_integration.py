"""Real MongoDB Atlas integration smoke test - NOT part of the
reproducible core suite's required dependencies (it SKIPS, loudly and
with a clear reason, when Atlas isn't reachable from this environment -
never a silent false pass).

Why this exists despite tests/support/fake_mongo.py already covering
EventProcessor's logic: the fake cannot catch a bug class that only a
REAL MongoClient enforces - using a session with a different client
instance than the one that created it
(`InvalidOperation: Can only use session with the MongoClient that
started it`). That exact bug was hit during this phase's first live
run against real Atlas (main.py was constructing the db handle and the
client from two separate `AsyncIOMotorClient` instances) - see
db.py's `database_from_client` and docs/TIMELOG.md. This test is the
regression guard for that class of bug; the mocked suite is not a
substitute for it.

Cleans up every document it creates (scoped under a random test
aggregate id) so repeated runs never accumulate junk in the real
insights_db.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import UTC, datetime

import pytest
from pymongo.errors import PyMongoError

from activity_insights.config import Settings
from activity_insights.db import database_from_client, get_client
from activity_insights.messaging.processor import EventProcessor, Outcome


def _real_env_settings() -> Settings:
    """tests/conftest.py forces MONGODB_URI/MONGODB_DB_NAME to a
    deliberately-unreachable placeholder (via os.environ.setdefault) so
    every OTHER test never accidentally touches a real database -
    pydantic-settings' env vars take precedence over its own .env file,
    so that placeholder would otherwise shadow the real local .env this
    one test needs. Temporarily clear it so Settings() reads the real
    .env file instead, then restore it for every other test."""
    saved = {key: os.environ.pop(key, None) for key in ("MONGODB_URI", "MONGODB_DB_NAME")}
    try:
        return Settings(_env_file=".env")
    finally:
        for key, value in saved.items():
            if value is not None:
                os.environ[key] = value


async def _atlas_reachable(settings: Settings) -> bool:
    if not settings.mongodb_uri or "<username>" in settings.mongodb_uri:
        return False
    try:
        client = get_client(settings)
        db = database_from_client(client, settings)
        await db.command("ping")
        return True
    except PyMongoError:
        return False


@pytest.mark.asyncio
async def test_real_atlas_transaction_round_trip() -> None:
    settings = _real_env_settings()
    if not await _atlas_reachable(settings):
        pytest.skip("MONGODB_URI is not configured to a reachable real Atlas cluster - skipping.")

    client = get_client(settings)
    db = database_from_client(client, settings)
    namespace = f"test_{uuid.uuid4().hex[:8]}_"
    processor = EventProcessor(client, db, consumer_name="test-real-mongo", namespace=namespace)

    item_id = f"test-item-{uuid.uuid4().hex[:8]}"
    doc = {
        "eventId": f"test-evt-{uuid.uuid4().hex[:8]}",
        "eventType": "workitem.created",
        "schemaVersion": 1,
        "occurredAt": datetime.now(UTC).isoformat(),
        "producer": "management-service",
        "workspaceId": "ws_test",
        "aggregate": {"type": "WorkItem", "id": item_id, "version": 1},
        "correlationId": "corr_test",
        "causationId": None,
        "actorId": "user_test",
        "payload": {
            "projectId": "proj_test",
            "columnId": "todo",
            "priority": "low",
            "assigneeId": None,
        },
    }
    raw = json.dumps(doc).encode("utf-8")

    try:
        result = await processor.process(raw, stream_seq=1, num_delivered=1)
        assert result.outcome == Outcome.PROCESSED

        # The actual regression check: this must be a genuinely NEW
        # document, created through a real multi-write transaction on
        # the real client - not just "no exception was raised".
        stored = await db[f"{namespace}item_state"].find_one({"_id": item_id})
        assert stored is not None
        assert stored["columnId"] == "todo"
    finally:
        for collection in (
            "item_state",
            "workload_projection",
            "activity_projection",
            "inbox",
            "consumer_state",
        ):
            await db.drop_collection(f"{namespace}{collection}")

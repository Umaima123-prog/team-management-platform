"""Real integration test for replay.py's `run_replay` - the one
checklist item (Phase 7) that had zero automated coverage: everything
about it was previously only exercised by hand against the real stream
(see docs/TIMELOG.md Phase 5 notes), never by an automated regression
test.

Requires both a reachable real NATS (fails loudly if not, same policy
as test_nats_integration.py - replay.py only ever runs against the
real TEAM_EVENTS stream, there is no throwaway-stream variant of it)
and a reachable real Atlas (skips loudly with a clear reason if not,
same policy as test_real_mongo_integration.py, since Atlas has a
documented history of transient unreachability - docs/DECISIONS.md
#11). Publishes one fresh, uniquely-identified event first so the
assertion is deterministic regardless of how much unrelated history
already exists on the real stream; cleans up its own namespaced
collections and its own throwaway replay consumer afterward, and never
touches the live collections or the assignment-mandated
`activity-insights-v1` consumer.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import UTC, datetime

import nats
import pytest
from pymongo.errors import PyMongoError

from activity_insights import replay as replay_module
from activity_insights.config import Settings
from activity_insights.db import database_from_client, get_client
from activity_insights.events.subjects import TEAM_EVENTS_STREAM_NAME, subject_for_event_type

NATS_URL = "nats://localhost:4222"


def _real_env_settings() -> Settings:
    """See test_real_mongo_integration.py's identical helper - env vars
    are popped/restored only around constructing this one object, never
    left mutated at module scope. `run_replay` calls `get_settings()`
    itself internally (no settings parameter), so the test patches that
    one lookup (see `monkeypatch.setattr` below) rather than relying on
    process env state for the duration of the call."""
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
async def test_run_replay_projects_a_real_published_event_into_namespaced_collections(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _real_env_settings()
    if not await _atlas_reachable(settings):
        pytest.skip("MONGODB_URI is not configured to a reachable real Atlas cluster - skipping.")

    # run_replay() calls get_settings() itself - point it at the real
    # settings we already validated above, without touching process env.
    monkeypatch.setattr(replay_module, "get_settings", lambda: settings)

    item_id = f"test-replay-item-{uuid.uuid4().hex[:8]}"
    event_id = f"test-replay-evt-{uuid.uuid4().hex[:8]}"
    doc = {
        "eventId": event_id,
        "eventType": "workitem.created",
        "schemaVersion": 1,
        "occurredAt": datetime.now(UTC).isoformat(),
        "producer": "management-service",
        "workspaceId": "ws_test_replay",
        "aggregate": {"type": "WorkItem", "id": item_id, "version": 1},
        "correlationId": "corr_test_replay",
        "causationId": None,
        "actorId": "user_test_replay",
        "payload": {
            "issueKey": "REPLAYTEST-1",
            "projectId": "proj_test_replay",
            "columnId": "col_todo",
            "priority": "HIGH",
            "assigneeId": None,
            "reporterId": "user_test_replay",
            "labels": [],
        },
    }

    # Fails loudly (not a silent skip) if Docker NATS is not running -
    # replay.py has no throwaway-stream mode, it only ever targets the
    # real TEAM_EVENTS stream.
    nc = await nats.connect(NATS_URL, connect_timeout=5)
    try:
        js = nc.jetstream()
        ack = await js.publish(
            subject_for_event_type("workitem.created"),
            json.dumps(doc).encode("utf-8"),
            timeout=5,
        )
        assert ack.stream == TEAM_EVENTS_STREAM_NAME
    finally:
        await nc.close()

    namespace = f"test_replay_{uuid.uuid4().hex[:8]}_"
    consumer_name = f"activity-insights-replay-test-{uuid.uuid4().hex[:8]}"

    client = get_client(settings)
    db = database_from_client(client, settings)
    try:
        summary = await replay_module.run_replay(namespace, consumer_name, idle_timeout_s=3.0)

        # The real thing under test: a full replay from the beginning
        # of the real stream must have picked up this just-published
        # event along with however much other real history exists.
        assert summary.messages_fetched >= 1

        stored_item = await db[f"{namespace}item_state"].find_one({"_id": item_id})
        assert stored_item is not None
        assert stored_item["issueKey"] == "REPLAYTEST-1"
        assert stored_item["columnId"] == "col_todo"

        stored_activity = await db[f"{namespace}activity_projection"].find_one(
            {"_id": event_id}
        )
        assert stored_activity is not None
        assert stored_activity["aggregateId"] == item_id

        assert await db[f"{namespace}inbox"].find_one(
            {"event_id": event_id, "consumer": consumer_name}
        )
    finally:
        for collection in (
            "item_state",
            "workload_projection",
            "activity_projection",
            "inbox",
            "consumer_state",
        ):
            await db.drop_collection(f"{namespace}{collection}")

        nc2 = await nats.connect(NATS_URL, connect_timeout=5)
        try:
            js2 = nc2.jetstream()
            await js2.delete_consumer(TEAM_EVENTS_STREAM_NAME, consumer_name)
        finally:
            await nc2.close()

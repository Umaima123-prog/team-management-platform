import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from activity_insights.consumer_state import ConsumerStateRepository
from activity_insights.messaging.activity_responder import ActivityResponder
from activity_insights.projections.activity import ActivityProjectionRepository
from activity_insights.projections.state import ItemStateRepository
from support.fake_mongo import FakeDatabase


def _fake_msg(payload: dict) -> MagicMock:
    msg = MagicMock()
    msg.data = json.dumps(payload).encode("utf-8")
    msg.respond = AsyncMock()
    return msg


def _responder(db: FakeDatabase) -> ActivityResponder:
    return ActivityResponder(
        nc=MagicMock(),
        activity=ActivityProjectionRepository(db),
        consumer_state=ConsumerStateRepository(db),
        item_state=ItemStateRepository(db),
        consumer_name="test-consumer",
    )


def _reply(msg: MagicMock) -> dict:
    (data,), _ = msg.respond.call_args
    return json.loads(data.decode("utf-8"))


@pytest.mark.asyncio
async def test_not_ready_when_project_has_no_activity_yet() -> None:
    db = FakeDatabase()
    responder = _responder(db)
    msg = _fake_msg({"projectId": "proj_unknown", "workspaceId": "ws_1"})

    await responder._handle(msg)

    body = _reply(msg)
    assert body["status"] == "not_ready"
    assert body["reason"] == "NO_DATA_YET_FOR_PROJECT"


@pytest.mark.asyncio
async def test_malformed_request_is_not_ready_not_a_crash() -> None:
    db = FakeDatabase()
    responder = _responder(db)
    msg = _fake_msg({"nope": "no projectId"})

    await responder._handle(msg)

    body = _reply(msg)
    assert body["status"] == "not_ready"
    assert body["reason"] == "MALFORMED_REQUEST"


@pytest.mark.asyncio
async def test_ok_response_returns_entries_newest_first() -> None:
    db = FakeDatabase()
    await db["activity_projection"].insert_one(
        {
            "_id": "evt-1",
            "projectId": "proj_1",
            "workspaceId": "ws_1",
            "eventType": "workitem.created",
            "aggregateType": "WorkItem",
            "aggregateId": "wi-1",
            "actorId": "user-1",
            "occurredAt": "2026-10-07T00:00:00+00:00",
        }
    )
    await db["activity_projection"].insert_one(
        {
            "_id": "evt-2",
            "projectId": "proj_1",
            "workspaceId": "ws_1",
            "eventType": "workitem.moved",
            "aggregateType": "WorkItem",
            "aggregateId": "wi-1",
            "actorId": "user-1",
            "occurredAt": "2026-10-07T01:00:00+00:00",
        }
    )
    await db["consumer_state"].insert_one({"_id": "test-consumer", "lastProcessedStreamSeq": 7})

    responder = _responder(db)
    msg = _fake_msg({"projectId": "proj_1", "workspaceId": "ws_1"})

    await responder._handle(msg)

    body = _reply(msg)
    assert body["status"] == "ok"
    assert [e["eventId"] for e in body["data"]["entries"]] == ["evt-2", "evt-1"]
    assert body["data"]["lastProcessedSequence"] == 7


@pytest.mark.asyncio
async def test_workspace_mismatch_is_not_ready() -> None:
    db = FakeDatabase()
    await db["activity_projection"].insert_one(
        {
            "_id": "evt-1",
            "projectId": "proj_1",
            "workspaceId": "ws_real",
            "eventType": "workitem.created",
            "aggregateType": "WorkItem",
            "aggregateId": "wi-1",
            "actorId": "user-1",
            "occurredAt": "2026-10-07T00:00:00+00:00",
        }
    )
    responder = _responder(db)
    msg = _fake_msg({"projectId": "proj_1", "workspaceId": "ws_wrong"})

    await responder._handle(msg)

    body = _reply(msg)
    assert body["status"] == "not_ready"
    assert body["reason"] == "WORKSPACE_MISMATCH"


@pytest.mark.asyncio
async def test_work_item_entries_are_enriched_with_issue_key_from_item_state() -> None:
    """The real bug this covers: Activity previously showed raw
    aggregateIds (e.g. "moved WorkItem 6ac5..."). issueKey must be
    resolved from item_state (itself built only from real events -
    never a management_db read) and attached to every WorkItem entry."""
    db = FakeDatabase()
    await db["item_state"].insert_one({"_id": "wi-1", "issueKey": "PH5VER-2", "version": 2})
    await db["activity_projection"].insert_one(
        {
            "_id": "evt-1",
            "projectId": "proj_1",
            "workspaceId": "ws_1",
            "eventType": "workitem.moved",
            "aggregateType": "WorkItem",
            "aggregateId": "wi-1",
            "actorId": "user-1",
            "occurredAt": "2026-10-07T01:00:00+00:00",
        }
    )
    await db["activity_projection"].insert_one(
        {
            "_id": "evt-2",
            "projectId": "proj_1",
            "workspaceId": "ws_1",
            "eventType": "project.created",
            "aggregateType": "Project",
            "aggregateId": "proj_1",
            "actorId": "user-1",
            "occurredAt": "2026-10-07T00:00:00+00:00",
        }
    )

    responder = _responder(db)
    msg = _fake_msg({"projectId": "proj_1", "workspaceId": "ws_1"})

    await responder._handle(msg)

    body = _reply(msg)
    entries = {e["eventId"]: e for e in body["data"]["entries"]}
    assert entries["evt-1"]["issueKey"] == "PH5VER-2"
    # A non-WorkItem aggregate (no issue key concept at all) must not
    # error out and must simply carry no issueKey.
    assert entries["evt-2"]["issueKey"] is None


@pytest.mark.asyncio
async def test_work_item_without_a_known_issue_key_falls_back_to_none_not_a_crash() -> None:
    """A work item whose "created" event hasn't been processed yet (or
    predates this feature) has no item_state entry - must not crash,
    issueKey is simply None and the UI falls back to the raw id."""
    db = FakeDatabase()
    await db["activity_projection"].insert_one(
        {
            "_id": "evt-1",
            "projectId": "proj_1",
            "workspaceId": "ws_1",
            "eventType": "workitem.moved",
            "aggregateType": "WorkItem",
            "aggregateId": "wi-unknown",
            "actorId": "user-1",
            "occurredAt": "2026-10-07T01:00:00+00:00",
        }
    )

    responder = _responder(db)
    msg = _fake_msg({"projectId": "proj_1", "workspaceId": "ws_1"})

    await responder._handle(msg)

    body = _reply(msg)
    assert body["data"]["entries"][0]["issueKey"] is None

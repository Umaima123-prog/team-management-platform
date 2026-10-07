import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from activity_insights.consumer_state import ConsumerStateRepository
from activity_insights.messaging.responder import InsightsResponder
from activity_insights.projections.activity import ActivityProjectionRepository
from activity_insights.projections.workload import WorkloadProjectionRepository
from support.fake_mongo import FakeDatabase


def _fake_msg(payload: dict) -> MagicMock:
    msg = MagicMock()
    msg.data = json.dumps(payload).encode("utf-8")
    msg.respond = AsyncMock()
    return msg


def _responder(db: FakeDatabase) -> InsightsResponder:
    return InsightsResponder(
        nc=MagicMock(),
        workload=WorkloadProjectionRepository(db),
        activity=ActivityProjectionRepository(db),
        consumer_state=ConsumerStateRepository(db),
        consumer_name="test-consumer",
    )


def _reply(msg: MagicMock) -> dict:
    (data,), _ = msg.respond.call_args
    return json.loads(data.decode("utf-8"))


@pytest.mark.asyncio
async def test_not_ready_when_project_has_no_data_yet() -> None:
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
async def test_ok_response_includes_workload_and_last_processed_sequence() -> None:
    db = FakeDatabase()
    await db["activity_projection"].insert_one(
        {"_id": "evt-1", "projectId": "proj_1", "workspaceId": "ws_1"}
    )
    await db["workload_projection"].insert_one(
        {
            "_id": "proj_1:assigneeId:user_a",
            "projectId": "proj_1",
            "dimension": "assigneeId",
            "key": "user_a",
            "count": 2,
        }
    )
    await db["workload_projection"].insert_one(
        {
            "_id": "proj_1:columnId:todo",
            "projectId": "proj_1",
            "dimension": "columnId",
            "key": "todo",
            "count": 2,
        }
    )
    await db["consumer_state"].insert_one(
        {"_id": "test-consumer", "lastProcessedStreamSeq": 42}
    )

    responder = _responder(db)
    msg = _fake_msg({"projectId": "proj_1", "workspaceId": "ws_1"})

    await responder._handle(msg)

    body = _reply(msg)
    assert body["status"] == "ok"
    assert body["data"]["projectId"] == "proj_1"
    assert {"assigneeId": "user_a", "count": 2} in body["data"]["workloadByAssignee"]
    assert {"columnId": "todo", "count": 2} in body["data"]["countsByStatus"]
    assert body["data"]["lastProcessedSequence"] == 42


@pytest.mark.asyncio
async def test_workspace_mismatch_is_not_ready() -> None:
    db = FakeDatabase()
    await db["activity_projection"].insert_one(
        {"_id": "evt-1", "projectId": "proj_1", "workspaceId": "ws_real"}
    )
    responder = _responder(db)
    msg = _fake_msg({"projectId": "proj_1", "workspaceId": "ws_wrong"})

    await responder._handle(msg)

    body = _reply(msg)
    assert body["status"] == "not_ready"
    assert body["reason"] == "WORKSPACE_MISMATCH"

import json
from datetime import UTC, datetime

import pytest
from pymongo.errors import AutoReconnect

from activity_insights.messaging.errors import ProcessingErrorCode
from activity_insights.messaging.processor import EventProcessor, Outcome
from support.fake_mongo import FakeDatabase, FakeMongoClient

CONSUMER = "test-activity-insights-v1"


def _envelope(
    event_type: str,
    *,
    aggregate_id: str = "wi_1",
    version: int = 1,
    event_id: str | None = None,
    payload: dict | None = None,
) -> bytes:
    doc = {
        "eventId": event_id or f"evt-{event_type}-{aggregate_id}-{version}",
        "eventType": event_type,
        "schemaVersion": 1,
        "occurredAt": datetime.now(UTC).isoformat(),
        "producer": "management-service",
        "workspaceId": "ws_1",
        "aggregate": {"type": "WorkItem", "id": aggregate_id, "version": version},
        "correlationId": "corr_1",
        "causationId": None,
        "actorId": "user_1",
        "payload": payload or {},
    }
    return json.dumps(doc).encode("utf-8")


def _processor() -> EventProcessor:
    return EventProcessor(FakeMongoClient(), FakeDatabase(), consumer_name=CONSUMER)


@pytest.mark.asyncio
async def test_valid_event_is_processed_and_counted() -> None:
    processor = _processor()
    raw = _envelope(
        "workitem.created",
        payload={
            "projectId": "proj_1",
            "columnId": "todo",
            "priority": "high",
            "assigneeId": "user_a",
            "reporterId": "user_1",
            "issueKey": "PRJ-1",
            "boardId": "board_1",
            "type": "task",
            "labels": [],
        },
    )

    result = await processor.process(raw, stream_seq=1, num_delivered=1)

    assert result.outcome == Outcome.PROCESSED
    rows = await processor.workload.counts_for_dimension("proj_1", "assigneeId")
    assert rows == [{"key": "user_a", "count": 1}]
    assert await processor.activity.has_any("proj_1") is True


@pytest.mark.asyncio
async def test_duplicate_event_is_not_reprocessed() -> None:
    processor = _processor()
    raw = _envelope(
        "workitem.created",
        event_id="evt-dup",
        payload={
            "projectId": "proj_1",
            "columnId": "todo",
            "priority": "high",
            "assigneeId": "user_a",
        },
    )

    first = await processor.process(raw, stream_seq=1, num_delivered=1)
    second = await processor.process(raw, stream_seq=2, num_delivered=1)

    assert first.outcome == Outcome.PROCESSED
    assert second.outcome == Outcome.DUPLICATE
    rows = await processor.workload.counts_for_dimension("proj_1", "assigneeId")
    assert rows == [{"key": "user_a", "count": 1}]  # not double-counted


@pytest.mark.asyncio
async def test_out_of_order_version_does_not_overwrite_newer_state() -> None:
    processor = _processor()
    created = _envelope(
        "workitem.created",
        version=1,
        event_id="evt-created",
        payload={"projectId": "proj_1", "columnId": "todo", "priority": "low", "assigneeId": None},
    )
    moved_v3 = _envelope(
        "workitem.moved",
        version=3,
        event_id="evt-moved-v3",
        payload={"projectId": "proj_1", "fromColumnId": "todo", "toColumnId": "done", "rank": 1},
    )
    # A stale/redelivered older-version event for the SAME aggregate,
    # arriving AFTER a newer one was already applied.
    stale_moved_v2 = _envelope(
        "workitem.moved",
        version=2,
        event_id="evt-moved-v2",
        payload={"projectId": "proj_1", "fromColumnId": "todo", "toColumnId": "doing", "rank": 1},
    )

    await processor.process(created, stream_seq=1, num_delivered=1)
    await processor.process(moved_v3, stream_seq=2, num_delivered=1)
    stale_result = await processor.process(stale_moved_v2, stream_seq=3, num_delivered=1)

    assert stale_result.outcome == Outcome.STALE_VERSION
    rows = await processor.workload.counts_for_dimension("proj_1", "columnId")
    counts = {row["key"]: row["count"] for row in rows}
    assert counts.get("done") == 1
    assert "doing" not in counts  # the stale event's target column never got applied


@pytest.mark.asyncio
async def test_malformed_schema_goes_to_poison_path() -> None:
    processor = _processor()
    raw = b'{"eventId": "evt-1", "eventType": "team.created"}'  # missing required fields

    result = await processor.process(raw, stream_seq=1, num_delivered=1)

    assert result.outcome == Outcome.POISONED
    failures = [doc async for doc in processor.failures._collection.find({})]
    assert len(failures) == 1
    assert failures[0]["reasonCode"] == ProcessingErrorCode.SCHEMA_INVALID


@pytest.mark.asyncio
async def test_unsupported_schema_version_goes_to_poison_path() -> None:
    processor = _processor()
    raw = _envelope("team.created", payload={"code": "ENG", "name": "Engineering"})
    doc = json.loads(raw)
    doc["schemaVersion"] = 2
    raw = json.dumps(doc).encode("utf-8")

    result = await processor.process(raw, stream_seq=1, num_delivered=1)

    assert result.outcome == Outcome.POISONED
    failures = [d async for d in processor.failures._collection.find({})]
    assert failures[0]["reasonCode"] == ProcessingErrorCode.UNSUPPORTED_SCHEMA_VERSION


@pytest.mark.asyncio
async def test_unknown_event_type_is_non_retryable_and_poisoned() -> None:
    processor = _processor()
    raw = _envelope("workitem.teleported", aggregate_id="wi_x")

    result = await processor.process(raw, stream_seq=1, num_delivered=1)

    assert result.outcome == Outcome.POISONED
    failures = [d async for d in processor.failures._collection.find({})]
    assert failures[0]["reasonCode"] == ProcessingErrorCode.UNKNOWN_EVENT_TYPE


@pytest.mark.asyncio
async def test_transient_mongo_error_is_not_acked(monkeypatch: pytest.MonkeyPatch) -> None:
    processor = _processor()
    raw = _envelope(
        "workitem.created",
        payload={"projectId": "proj_1", "columnId": "todo", "priority": "low", "assigneeId": None},
    )

    async def boom(*_args: object, **_kwargs: object) -> None:
        raise AutoReconnect("simulated transient outage")

    monkeypatch.setattr(processor.item_state._collection, "find_one", boom)

    result = await processor.process(raw, stream_seq=1, num_delivered=1)

    assert result.outcome == Outcome.TRANSIENT_FAILURE
    # Never recorded as a failure, and never inbox-marked - must be safe to retry.
    assert await processor.inbox.already_processed(json.loads(raw)["eventId"], CONSUMER) is False


@pytest.mark.asyncio
async def test_reassignment_decrements_old_assignee_increments_new() -> None:
    processor = _processor()
    created = _envelope(
        "workitem.created",
        version=1,
        event_id="evt-created",
        payload={
            "projectId": "proj_1",
            "columnId": "todo",
            "priority": "high",
            "assigneeId": "user_a",
        },
    )
    reassigned = _envelope(
        "workitem.assigned",
        version=2,
        event_id="evt-assigned",
        payload={"projectId": "proj_1", "previousAssigneeId": "user_a", "assigneeId": "user_b"},
    )

    await processor.process(created, stream_seq=1, num_delivered=1)
    result = await processor.process(reassigned, stream_seq=2, num_delivered=1)

    assert result.outcome == Outcome.PROCESSED
    rows = await processor.workload.counts_for_dimension("proj_1", "assigneeId")
    counts = {row["key"]: row["count"] for row in rows}
    assert counts == {"user_a": 0, "user_b": 1}


@pytest.mark.asyncio
async def test_reassignment_is_idempotent_under_redelivery() -> None:
    processor = _processor()
    created = _envelope(
        "workitem.created",
        version=1,
        event_id="evt-created",
        payload={
            "projectId": "proj_1",
            "columnId": "todo",
            "priority": "high",
            "assigneeId": "user_a",
        },
    )
    reassigned = _envelope(
        "workitem.assigned",
        version=2,
        event_id="evt-assigned",
        payload={"projectId": "proj_1", "previousAssigneeId": "user_a", "assigneeId": "user_b"},
    )

    await processor.process(created, stream_seq=1, num_delivered=1)
    await processor.process(reassigned, stream_seq=2, num_delivered=1)
    # Redelivered (e.g. ack was lost in flight) - must not double-apply.
    repeat = await processor.process(reassigned, stream_seq=2, num_delivered=2)

    assert repeat.outcome == Outcome.DUPLICATE
    rows = await processor.workload.counts_for_dimension("proj_1", "assigneeId")
    counts = {row["key"]: row["count"] for row in rows}
    assert counts == {"user_a": 0, "user_b": 1}


@pytest.mark.asyncio
async def test_movement_delta_updates_column_counts() -> None:
    processor = _processor()
    created = _envelope(
        "workitem.created",
        version=1,
        event_id="evt-created",
        payload={"projectId": "proj_1", "columnId": "todo", "priority": "high", "assigneeId": None},
    )
    moved = _envelope(
        "workitem.moved",
        version=2,
        event_id="evt-moved",
        payload={"projectId": "proj_1", "fromColumnId": "todo", "toColumnId": "doing", "rank": 1},
    )

    await processor.process(created, stream_seq=1, num_delivered=1)
    await processor.process(moved, stream_seq=2, num_delivered=1)

    rows = await processor.workload.counts_for_dimension("proj_1", "columnId")
    counts = {row["key"]: row["count"] for row in rows}
    assert counts == {"todo": 0, "doing": 1}


@pytest.mark.asyncio
async def test_archived_item_removed_from_active_buckets() -> None:
    processor = _processor()
    created = _envelope(
        "workitem.created",
        version=1,
        event_id="evt-created",
        payload={
            "projectId": "proj_1",
            "columnId": "todo",
            "priority": "high",
            "assigneeId": "user_a",
        },
    )
    archived = _envelope(
        "workitem.archived",
        version=2,
        event_id="evt-archived",
        payload={"projectId": "proj_1", "previousColumnId": "todo"},
    )

    await processor.process(created, stream_seq=1, num_delivered=1)
    result = await processor.process(archived, stream_seq=2, num_delivered=1)

    assert result.outcome == Outcome.PROCESSED
    column_counts = {
        row["key"]: row["count"]
        for row in await processor.workload.counts_for_dimension("proj_1", "columnId")
    }
    assignee_counts = {
        row["key"]: row["count"]
        for row in await processor.workload.counts_for_dimension("proj_1", "assigneeId")
    }
    priority_counts = {
        row["key"]: row["count"]
        for row in await processor.workload.counts_for_dimension("proj_1", "priority")
    }
    assert column_counts == {"todo": 0}
    assert assignee_counts == {"user_a": 0}
    assert priority_counts == {"high": 0}

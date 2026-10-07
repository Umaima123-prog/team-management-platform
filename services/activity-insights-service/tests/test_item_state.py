import json

import pytest

from activity_insights.events.envelope import parse_envelope
from activity_insights.projections.state import ItemStateRepository
from support.fake_mongo import FakeDatabase, FakeMongoClient


def _envelope(event_type: str, aggregate_id: str, version: int, payload: dict):
    doc = {
        "eventId": f"evt-{aggregate_id}-{version}",
        "eventType": event_type,
        "schemaVersion": 1,
        "occurredAt": "2026-10-07T00:00:00.000Z",
        "producer": "management-service",
        "workspaceId": "ws_1",
        "aggregate": {"type": "WorkItem", "id": aggregate_id, "version": version},
        "correlationId": "corr_1",
        "causationId": None,
        "actorId": "user_1",
        "payload": payload,
    }
    return parse_envelope(json.dumps(doc).encode("utf-8"))


@pytest.mark.asyncio
async def test_created_event_captures_issue_key_into_item_state() -> None:
    db = FakeDatabase()
    repo = ItemStateRepository(db)
    client = FakeMongoClient()
    session = await client.start_session()

    envelope = _envelope(
        "workitem.created",
        "wi-1",
        1,
        {
            "issueKey": "PH5VER-2",
            "projectId": "proj_1",
            "columnId": "col-1",
            "priority": "HIGH",
            "assigneeId": None,
            "reporterId": "user_1",
            "labels": [],
        },
    )
    await repo.apply_event(session, envelope)

    keys = await repo.get_issue_keys(["wi-1"])
    assert keys == {"wi-1": "PH5VER-2"}


@pytest.mark.asyncio
async def test_get_issue_keys_omits_items_with_no_known_key() -> None:
    db = FakeDatabase()
    repo = ItemStateRepository(db)
    client = FakeMongoClient()
    session = await client.start_session()

    # workitem.moved alone (no prior "created" processed) never
    # carries an issueKey in its own payload.
    moved = _envelope(
        "workitem.moved",
        "wi-2",
        1,
        {"projectId": "proj_1", "fromColumnId": "col-1", "toColumnId": "col-2", "rank": 1},
    )
    await repo.apply_event(session, moved)

    keys = await repo.get_issue_keys(["wi-2", "wi-missing"])
    assert keys == {}


@pytest.mark.asyncio
async def test_get_issue_keys_with_empty_input_does_not_query() -> None:
    db = FakeDatabase()
    repo = ItemStateRepository(db)

    assert await repo.get_issue_keys([]) == {}


@pytest.mark.asyncio
async def test_backfill_issue_key_fills_in_a_document_missing_one() -> None:
    """Reproduces the bug found in the user's manual Chrome
    verification: an item_state document projected before issueKey
    capture existed on workitem.created (docs/DECISIONS.md #30)."""
    db = FakeDatabase()
    repo = ItemStateRepository(db)
    client = FakeMongoClient()
    session = await client.start_session()

    # A pre-fix "workitem.moved" is all that was ever projected for
    # this item - no issueKey field exists on its document at all.
    moved = _envelope(
        "workitem.moved",
        "wi-old",
        3,
        {"projectId": "proj_1", "fromColumnId": "col-1", "toColumnId": "col-2", "rank": 1},
    )
    await repo.apply_event(session, moved)
    assert await repo.get_issue_keys(["wi-old"]) == {}

    updated = await repo.backfill_issue_key("wi-old", "PH6BACKFILL-1")
    assert updated is True
    assert await repo.get_issue_keys(["wi-old"]) == {"wi-old": "PH6BACKFILL-1"}


@pytest.mark.asyncio
async def test_backfill_issue_key_is_idempotent_and_never_overwrites() -> None:
    db = FakeDatabase()
    repo = ItemStateRepository(db)
    client = FakeMongoClient()
    session = await client.start_session()

    created = _envelope(
        "workitem.created",
        "wi-already-keyed",
        1,
        {
            "issueKey": "REAL-1",
            "projectId": "proj_1",
            "columnId": "col-1",
            "priority": "HIGH",
            "assigneeId": None,
            "reporterId": "user_1",
            "labels": [],
        },
    )
    await repo.apply_event(session, created)

    # A second run (e.g. backfill re-run, or a replay of the same
    # history) must never overwrite an already-correct value with a
    # different one.
    updated = await repo.backfill_issue_key("wi-already-keyed", "WRONG-999")
    assert updated is False
    assert await repo.get_issue_keys(["wi-already-keyed"]) == {"wi-already-keyed": "REAL-1"}


@pytest.mark.asyncio
async def test_backfill_issue_key_never_creates_a_document() -> None:
    """A missing item_state document means this item's `created` event
    hasn't actually been projected yet - backfill must not paper over
    that by inventing one."""
    db = FakeDatabase()
    repo = ItemStateRepository(db)

    updated = await repo.backfill_issue_key("wi-never-seen", "SOME-1")
    assert updated is False
    assert await repo.get_issue_keys(["wi-never-seen"]) == {}

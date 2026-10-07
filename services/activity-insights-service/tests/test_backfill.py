"""Unit tests for backfill.py's per-event decision logic
(apply_backfill_event), pulled out of the NATS fetch loop specifically
so it's testable without a real broker - the loop itself (fetch/ack/
delete-consumer) is exercised live, by hand, against the real stream
per docs/DECISIONS.md #30, not re-simulated here."""

import json

import pytest

from activity_insights.backfill import apply_backfill_event
from activity_insights.events.envelope import parse_envelope
from activity_insights.projections.state import ItemStateRepository
from support.fake_mongo import FakeDatabase, FakeMongoClient


def _created_envelope(aggregate_id: str, version: int, issue_key, extra: dict | None = None):
    payload = {
        "issueKey": issue_key,
        "projectId": "proj_1",
        "columnId": "col-1",
        "priority": "HIGH",
        "assigneeId": None,
        "reporterId": "user_1",
        "labels": [],
    }
    if extra:
        payload.update(extra)
    doc = {
        "eventId": f"evt-{aggregate_id}-{version}",
        "eventType": "workitem.created",
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
async def test_apply_backfill_event_fills_in_a_pre_existing_document() -> None:
    db = FakeDatabase()
    repo = ItemStateRepository(db)
    client = FakeMongoClient()
    session = await client.start_session()

    # Simulates the live consumer having already processed this item's
    # full history under the old (pre-issueKey-capture) code.
    pre_fix_created = _created_envelope("wi-1", 1, issue_key=None)
    await repo.apply_event(session, pre_fix_created)
    assert await repo.get_issue_keys(["wi-1"]) == {}

    real_created_event = _created_envelope("wi-1", 1, issue_key="PH6-1")
    updated = await apply_backfill_event(repo, real_created_event)

    assert updated is True
    assert await repo.get_issue_keys(["wi-1"]) == {"wi-1": "PH6-1"}


@pytest.mark.asyncio
async def test_apply_backfill_event_is_a_noop_without_an_existing_document() -> None:
    db = FakeDatabase()
    repo = ItemStateRepository(db)

    updated = await apply_backfill_event(repo, _created_envelope("wi-unseen", 1, issue_key="X-1"))

    assert updated is False
    assert await repo.get_issue_keys(["wi-unseen"]) == {}


@pytest.mark.asyncio
async def test_apply_backfill_event_skips_an_event_with_no_issue_key() -> None:
    db = FakeDatabase()
    repo = ItemStateRepository(db)
    client = FakeMongoClient()
    session = await client.start_session()

    event = _created_envelope("wi-2", 1, issue_key=None)
    await repo.apply_event(session, event)

    updated = await apply_backfill_event(repo, event)

    assert updated is False
    assert await repo.get_issue_keys(["wi-2"]) == {}

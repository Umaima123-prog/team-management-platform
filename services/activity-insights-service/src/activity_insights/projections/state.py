"""Per-work-item current-state tracking (item_state collection).

This is the mechanism that satisfies "aggregate.version must prevent
older/out-of-order events from overwriting newer projected state": a
plain `find_one` reads whatever is currently recorded for this
aggregate, and the write is only issued if the incoming event's
aggregate.version is strictly greater than that - a redelivered or
reordered older-version event is detected and reported as STALE
*before* any write is attempted, never by attempting a write and
reacting to a server-side error.

That "attempt and react to the error" shape was tried first and is
deliberately NOT used: this whole read-then-maybe-write runs inside
one multi-document MongoDB transaction (messaging/processor.py), and
MongoDB transactions do not allow "catch an operation's error in
application code and keep going" - once any command inside a
transaction returns certain errors (DuplicateKeyError included), the
*entire transaction* is marked aborted server-side, and every
subsequent operation (including the final commit) fails with
`NoSuchTransaction`/"Transaction has been aborted" regardless of
whether the application caught the original exception. Because that
failure carries the `TransientTransactionError` label, Motor's
`with_transaction` treats it as retryable and reruns the *whole* body
from scratch - which hits the identical deterministic error every
time, so it does not actually recover, it just retries uselessly until
its own internal time budget runs out (a real, reproducible multi-
second hang found running this phase's first live-replay pass against
the real backlog - see docs/TIMELOG.md and docs/DECISIONS.md #20). A
plain `find_one` can never itself fail in a way that poisons the
transaction, so STALE detection has to happen there, not via upsert
conflict.

workload_projection's counters (workload.py) are derived from the
*before/after* snapshots this module returns, never from an event's own
claimed "previous" value - that is what makes a reassignment/move/
archive delta correct even under at-least-once redelivery (the inbox
in inbox/repository.py is still what prevents the *same* event from
being applied twice; this module is what prevents a *stale* event from
corrupting state applied by a newer one).
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorDatabase

from ..collections import ITEM_STATE_COLLECTION
from ..events.envelope import EventEnvelope


class ItemEventKind(enum.StrEnum):
    FIRST_SEEN = "first_seen"
    UPDATED = "updated"
    STALE = "stale"


@dataclass(frozen=True)
class ItemEventOutcome:
    kind: ItemEventKind
    prior: dict[str, Any] | None
    new: dict[str, Any] | None


def _project_id_for(envelope: EventEnvelope) -> str | None:
    payload_project_id = envelope.payload.get("projectId")
    return payload_project_id if isinstance(payload_project_id, str) else None


def _fields_for_event(envelope: EventEnvelope) -> dict[str, Any]:
    """The work-item fields this specific eventType tells us about.
    Only the fields a given event actually carries are $set - fields it
    doesn't mention are left untouched on the existing document (see
    module docstring)."""
    payload = envelope.payload
    project_id = _project_id_for(envelope)
    fields: dict[str, Any] = {}
    if project_id is not None:
        fields["projectId"] = project_id

    event_type = envelope.eventType
    if event_type == "workitem.created":
        fields.update(
            columnId=payload.get("columnId"),
            priority=payload.get("priority"),
            assigneeId=payload.get("assigneeId"),
            archived=False,
        )
    elif event_type == "workitem.assigned":
        fields["assigneeId"] = payload.get("assigneeId")
    elif event_type == "workitem.moved":
        fields["columnId"] = payload.get("toColumnId")
    elif event_type == "workitem.updated":
        if "priority" in payload:
            fields["priority"] = payload["priority"]
    elif event_type == "workitem.archived":
        fields["archived"] = True
    return fields


class ItemStateRepository:
    """`namespace` prefixes the collection name so a replay run (see
    replay.py) can project into an entirely separate set of collections
    without ever touching the live ones - "replay into a clean
    projection" (assignment) without any special-casing elsewhere."""

    def __init__(self, db: AsyncIOMotorDatabase, *, namespace: str = "") -> None:
        self._collection = db[f"{namespace}{ITEM_STATE_COLLECTION}"]

    async def apply_event(
        self, session: AsyncIOMotorClientSession, envelope: EventEnvelope
    ) -> ItemEventOutcome:
        item_id = envelope.aggregate.id
        new_version = envelope.aggregate.version
        fields = _fields_for_event(envelope)
        now = datetime.now(UTC)

        existing = await self._collection.find_one({"_id": item_id}, session=session)

        if existing is not None and existing.get("version", 0) >= new_version:
            # Already holding a version >= this event's - stale/out-of-
            # order relative to projected state. No write is attempted
            # (see module docstring on why this must be a read-first
            # decision, never an upsert-conflict reaction). Still a
            # *successfully handled* event (inbox-recorded, acked) -
            # just a no-op for state.
            return ItemEventOutcome(kind=ItemEventKind.STALE, prior=None, new=None)

        update = {
            "$set": {**fields, "version": new_version, "updatedAt": now},
            "$setOnInsert": {"createdAt": now},
        }
        await self._collection.update_one(
            {"_id": item_id}, update, upsert=(existing is None), session=session
        )

        new_doc = {**(existing or {}), **fields, "_id": item_id, "version": new_version}
        kind = ItemEventKind.FIRST_SEEN if existing is None else ItemEventKind.UPDATED
        return ItemEventOutcome(kind=kind, prior=existing, new=new_doc)

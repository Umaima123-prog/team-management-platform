"""Activity projection: an append-only timeline of every event this
service has consumed (assignment: "Build activity projection from
events"), indexed for "activity for project X between times" lookups
(index_bootstrap.py: projectId+occurredAt).

Covers every known event type, not just work-item ones - "plus
relevant team/project events" (team.created, project.created, etc. are
activity-worthy even though they don't carry work-item workload
state). `_id` is the eventId itself, so a duplicate insert (defense in
depth - the inbox in inbox/repository.py is the primary dedup gate) is
simply ignored rather than double-recorded.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

from ..collections import ACTIVITY_PROJECTION_COLLECTION
from ..events.envelope import EventEnvelope


def _project_id_for(envelope: EventEnvelope) -> str | None:
    if envelope.aggregate.type == "Project":
        return envelope.aggregate.id
    payload_project_id = envelope.payload.get("projectId")
    return payload_project_id if isinstance(payload_project_id, str) else None


def _parse_occurred_at(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        # Already validated as "parses as a timestamp" is not
        # guaranteed by envelope.py (it only checks the field is a
        # non-empty string) - fall back to "now" rather than fail a
        # whole transaction over an unparseable-but-present timestamp.
        return datetime.now(UTC)


class ActivityProjectionRepository:
    def __init__(self, db: AsyncIOMotorDatabase, *, namespace: str = "") -> None:
        self._collection = db[f"{namespace}{ACTIVITY_PROJECTION_COLLECTION}"]

    async def record(
        self,
        session: AsyncIOMotorClientSession,
        envelope: EventEnvelope,
        stream_seq: int,
    ) -> None:
        doc: dict[str, Any] = {
            "_id": envelope.eventId,
            "projectId": _project_id_for(envelope),
            "workspaceId": envelope.workspaceId,
            "eventType": envelope.eventType,
            "aggregateType": envelope.aggregate.type,
            "aggregateId": envelope.aggregate.id,
            "aggregateVersion": envelope.aggregate.version,
            "actorId": envelope.actorId,
            "occurredAt": _parse_occurred_at(envelope.occurredAt),
            "correlationId": envelope.correlationId,
            "streamSeq": stream_seq,
            "recordedAt": datetime.now(UTC),
        }
        try:
            await self._collection.insert_one(doc, session=session)
        except DuplicateKeyError:
            pass

    async def has_any(self, project_id: str) -> bool:
        doc = await self._collection.find_one({"projectId": project_id}, {"_id": 1})
        return doc is not None

    async def workspace_for_project(self, project_id: str) -> str | None:
        doc = await self._collection.find_one(
            {"projectId": project_id}, {"workspaceId": 1}, sort=[("occurredAt", -1)]
        )
        return doc["workspaceId"] if doc else None

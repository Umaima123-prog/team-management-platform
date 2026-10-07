"""Workload projection: counters by project, grouped by column/status,
priority, and assignee (assignment: "Build workload projection by
project, column/status, priority, and assignee").

Each bucket is one document keyed by (projectId, dimension, key) with a
`count` field, maintained by $inc deltas computed from the *actual*
before/after transition of a work item's state (projections/state.py) -
never from an event's own claimed "previous" value. This is what makes
"reassignment must decrement old assignee and increment new assignee
idempotently" true: the delta is only ever applied once per genuine
state transition, because:

1. the inbox (inbox/repository.py) guarantees the same event is never
   applied twice, and
2. item_state's version gate (projections/state.py) guarantees a
   stale/out-of-order event is never treated as a transition at all.

An archived item is removed from every active bucket it occupied
(decremented, nothing incremented in its place) - archived work is no
longer open workload.
"""

from __future__ import annotations

from typing import Any

from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorDatabase

from ..collections import WORKLOAD_PROJECTION_COLLECTION
from .state import ItemEventKind, ItemEventOutcome

DIMENSIONS = ("columnId", "priority", "assigneeId")

_NULL_KEY_MARKER = "__null__"


def _bucket_id(project_id: str, dimension: str, key: Any) -> str:
    marker = _NULL_KEY_MARKER if key is None else str(key)
    return f"{project_id}:{dimension}:{marker}"


class WorkloadProjectionRepository:
    def __init__(self, db: AsyncIOMotorDatabase, *, namespace: str = "") -> None:
        self._collection = db[f"{namespace}{WORKLOAD_PROJECTION_COLLECTION}"]

    async def _increment(
        self,
        session: AsyncIOMotorClientSession,
        project_id: str,
        dimension: str,
        key: Any,
        delta: int,
    ) -> None:
        await self._collection.update_one(
            {"_id": _bucket_id(project_id, dimension, key)},
            {
                "$inc": {"count": delta},
                "$setOnInsert": {"projectId": project_id, "dimension": dimension, "key": key},
            },
            upsert=True,
            session=session,
        )

    async def apply_delta(
        self, session: AsyncIOMotorClientSession, outcome: ItemEventOutcome
    ) -> None:
        if outcome.kind == ItemEventKind.STALE:
            return

        new = outcome.new
        assert new is not None
        project_id = new.get("projectId")
        if not project_id:
            # Can legitimately happen if a redelivery-reordered
            # "assigned"/"moved" event is the very first one seen for
            # this item (its own payload carries projectId too, but a
            # defensive reread isn't worth it - see state.py docstring
            # on reordering limits). Nothing to bucket without a
            # project to bucket it under.
            return

        prior = outcome.prior
        was_active = prior is not None and not prior.get("archived", False)
        is_active = not new.get("archived", False)

        if outcome.kind == ItemEventKind.FIRST_SEEN:
            if is_active:
                for dim in DIMENSIONS:
                    await self._increment(session, project_id, dim, new.get(dim), +1)
            return

        # UPDATED
        for dim in DIMENSIONS:
            old_key = prior.get(dim) if prior else None
            new_key = new.get(dim)
            if was_active and is_active:
                if old_key != new_key:
                    await self._increment(session, project_id, dim, old_key, -1)
                    await self._increment(session, project_id, dim, new_key, +1)
            elif was_active and not is_active:
                await self._increment(session, project_id, dim, old_key, -1)
            elif not was_active and is_active:
                await self._increment(session, project_id, dim, new_key, +1)
            # else: inactive before and after - no-op.

    async def counts_for_dimension(self, project_id: str, dimension: str) -> list[dict[str, Any]]:
        cursor = self._collection.find(
            {"projectId": project_id, "dimension": dimension}, {"_id": 0, "key": 1, "count": 1}
        )
        return [doc async for doc in cursor]

    async def has_any(self, project_id: str) -> bool:
        doc = await self._collection.find_one({"projectId": project_id}, {"_id": 1})
        return doc is not None

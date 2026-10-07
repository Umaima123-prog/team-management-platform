"""Consumer-state tracking: the assignment's required health fields -
"last processed sequence, last successful processing time, freshness/
processing age".

Two layers, deliberately:

- `ConsumerStateRepository` persists to Mongo (`consumer_state`
  collection, one document per durable consumer name) so progress
  survives a process restart and is inspectable directly.
- `ConsumerStateView` is a cheap in-process cache of the same
  information, updated by the consumer loop and read by the health
  endpoint (health_app.py) without an extra DB round trip per health
  check.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorDatabase

from .collections import CONSUMER_STATE_COLLECTION


class ConsumerStateRepository:
    def __init__(self, db: AsyncIOMotorDatabase, *, namespace: str = "") -> None:
        self._collection = db[f"{namespace}{CONSUMER_STATE_COLLECTION}"]

    async def record_progress(
        self,
        consumer_name: str,
        stream_seq: int,
        at: datetime,
        *,
        session: AsyncIOMotorClientSession | None = None,
    ) -> None:
        await self._collection.update_one(
            {"_id": consumer_name},
            {
                "$set": {"lastProcessedStreamSeq": stream_seq, "lastSuccessAt": at},
                "$setOnInsert": {"_id": consumer_name},
            },
            upsert=True,
            session=session,
        )

    async def get(self, consumer_name: str) -> dict | None:
        return await self._collection.find_one({"_id": consumer_name})


@dataclass
class ConsumerStateSnapshot:
    durable_name: str
    connected: bool
    last_processed_stream_seq: int | None
    last_success_at: datetime | None

    def processing_age_seconds(self) -> float | None:
        if self.last_success_at is None:
            return None
        return (datetime.now(UTC) - self.last_success_at).total_seconds()


class ConsumerStateView:
    """Process-local, in-memory - not the source of truth (the Mongo
    collection is). Safe to read/write from different asyncio tasks:
    plain attribute assignment is atomic enough for this use (a health
    read racing a single-field update can only ever see an old-or-new
    consistent value, never a torn one)."""

    def __init__(self, durable_name: str) -> None:
        self._durable_name = durable_name
        self._connected = False
        self._last_processed_stream_seq: int | None = None
        self._last_success_at: datetime | None = None

    def mark_connected(self, connected: bool) -> None:
        self._connected = connected

    def mark_processed(self, stream_seq: int, at: datetime) -> None:
        self._last_processed_stream_seq = stream_seq
        self._last_success_at = at

    def snapshot(self) -> ConsumerStateSnapshot:
        return ConsumerStateSnapshot(
            durable_name=self._durable_name,
            connected=self._connected,
            last_processed_stream_seq=self._last_processed_stream_seq,
            last_success_at=self._last_success_at,
        )

"""Inbox repository: the dedup gate every consumed event must pass
through before (re)applying a projection update.

Processing is strictly sequential (one message at a time - see
messaging/consumer.py), so a plain "does this (event_id, consumer)
already exist" read-then-act is race-free in this process; the unique
index (index_bootstrap.py) is still the actual correctness backstop
(e.g. against a second instance of this service running by mistake).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClientSession, AsyncIOMotorDatabase

from ..collections import INBOX_COLLECTION


class InboxRepository:
    def __init__(self, db: AsyncIOMotorDatabase, *, namespace: str = "") -> None:
        self._collection = db[f"{namespace}{INBOX_COLLECTION}"]

    async def already_processed(self, event_id: str, consumer: str) -> bool:
        doc = await self._collection.find_one(
            {"event_id": event_id, "consumer": consumer}, {"_id": 1}
        )
        return doc is not None

    async def mark_processed(
        self,
        event_id: str,
        consumer: str,
        *,
        subject: str,
        stream_seq: int,
        session: AsyncIOMotorClientSession | None = None,
    ) -> None:
        doc: dict[str, Any] = {
            "event_id": event_id,
            "consumer": consumer,
            "subject": subject,
            "stream_seq": stream_seq,
            "processed_at": datetime.now(UTC),
        }
        await self._collection.insert_one(doc, session=session)

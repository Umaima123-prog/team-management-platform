from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from ..collections import PROCESSING_FAILURES_COLLECTION

# Bounded preview length - operator diagnostics only, never an
# unbounded blob store for arbitrarily large message bodies.
_RAW_PREVIEW_MAX_CHARS = 2_000


def _preview(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="replace")
    if len(text) > _RAW_PREVIEW_MAX_CHARS:
        return text[:_RAW_PREVIEW_MAX_CHARS] + "...(truncated)"
    return text


class ProcessingFailuresRepository:
    def __init__(self, db: AsyncIOMotorDatabase, *, namespace: str = "") -> None:
        self._collection = db[f"{namespace}{PROCESSING_FAILURES_COLLECTION}"]

    async def record(
        self,
        *,
        reason_code: str,
        detail: str,
        raw: bytes,
        stream_seq: int | None,
        event_id: str | None = None,
        event_type: str | None = None,
        subject: str | None = None,
        num_delivered: int | None = None,
    ) -> None:
        doc: dict[str, Any] = {
            "reasonCode": reason_code,
            "detail": detail,
            "rawPreview": _preview(raw),
            "streamSeq": stream_seq,
            "eventId": event_id,
            "eventType": event_type,
            "subject": subject,
            "numDelivered": num_delivered,
            "recordedAt": datetime.now(UTC),
        }
        # Deliberately not transactional and never allowed to raise
        # into the caller: recording a failure must not itself become
        # a reason the message can never be acked.
        try:
            await self._collection.insert_one(doc)
        except Exception:  # noqa: BLE001 - last-resort operator log, see module docstring
            import logging

            logging.getLogger(__name__).exception(
                "Failed to record processing failure (reasonCode=%s, eventId=%s) - "
                "this failure is now only visible in application logs.",
                reason_code,
                event_id,
            )

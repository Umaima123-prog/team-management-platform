"""EventProcessor: per-message orchestration.

For every delivered message this is the single place that decides what
"successfully handled" means (see Outcome below) - messaging/consumer.py
only translates an Outcome into an ack/nak/poison-and-ack decision, it
contains no domain logic itself.

ACK only happens (in consumer.py) after this returns PROCESSED,
DUPLICATE, STALE_VERSION, or POISONED - never after TRANSIENT_FAILURE
(assignment: "ACK only AFTER projection + inbox persistence succeeds").
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from datetime import UTC, datetime

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from ..consumer_state import ConsumerStateRepository
from ..events.envelope import (
    EnvelopeValidationError,
    UnknownEventTypeError,
    UnsupportedSchemaVersionError,
    parse_envelope,
)
from ..events.subjects import WORKITEM_EVENT_TYPES, subject_for_event_type
from ..failures.repository import ProcessingFailuresRepository
from ..inbox.repository import InboxRepository
from ..projections.activity import ActivityProjectionRepository
from ..projections.state import ItemEventKind, ItemStateRepository
from ..projections.workload import WorkloadProjectionRepository
from .errors import ProcessingErrorCode, is_transient_mongo_error


class Outcome(enum.StrEnum):
    PROCESSED = "processed"
    DUPLICATE = "duplicate"
    STALE_VERSION = "stale_version"
    POISONED = "poisoned"
    TRANSIENT_FAILURE = "transient_failure"


ACK_ELIGIBLE_OUTCOMES = frozenset(
    {Outcome.PROCESSED, Outcome.DUPLICATE, Outcome.STALE_VERSION, Outcome.POISONED}
)


@dataclass
class ProcessorResult:
    outcome: Outcome
    stream_seq: int
    event_id: str | None = None
    event_type: str | None = None


class EventProcessor:
    def __init__(
        self,
        client: AsyncIOMotorClient,
        db: AsyncIOMotorDatabase,
        *,
        consumer_name: str,
        namespace: str = "",
    ) -> None:
        self._client = client
        self._consumer_name = consumer_name
        self.inbox = InboxRepository(db, namespace=namespace)
        self.failures = ProcessingFailuresRepository(db, namespace=namespace)
        self.item_state = ItemStateRepository(db, namespace=namespace)
        self.workload = WorkloadProjectionRepository(db, namespace=namespace)
        self.activity = ActivityProjectionRepository(db, namespace=namespace)
        self.consumer_state = ConsumerStateRepository(db, namespace=namespace)

    async def process(self, raw: bytes, stream_seq: int, num_delivered: int) -> ProcessorResult:
        try:
            envelope = parse_envelope(raw)
        except EnvelopeValidationError as exc:
            await self.failures.record(
                reason_code=ProcessingErrorCode.SCHEMA_INVALID,
                detail=str(exc),
                raw=raw,
                stream_seq=stream_seq,
                num_delivered=num_delivered,
            )
            return ProcessorResult(Outcome.POISONED, stream_seq)
        except UnsupportedSchemaVersionError as exc:
            await self.failures.record(
                reason_code=ProcessingErrorCode.UNSUPPORTED_SCHEMA_VERSION,
                detail=str(exc),
                raw=raw,
                stream_seq=stream_seq,
                num_delivered=num_delivered,
            )
            return ProcessorResult(Outcome.POISONED, stream_seq)
        except UnknownEventTypeError as exc:
            await self.failures.record(
                reason_code=ProcessingErrorCode.UNKNOWN_EVENT_TYPE,
                detail=str(exc),
                raw=raw,
                stream_seq=stream_seq,
                num_delivered=num_delivered,
            )
            return ProcessorResult(Outcome.POISONED, stream_seq)

        if await self.inbox.already_processed(envelope.eventId, self._consumer_name):
            return ProcessorResult(
                Outcome.DUPLICATE, stream_seq, envelope.eventId, envelope.eventType
            )

        subject = subject_for_event_type(envelope.eventType)
        is_stale = False

        try:
            session = await self._client.start_session()
            try:
                async def body(s: object) -> None:
                    nonlocal is_stale
                    if envelope.eventType in WORKITEM_EVENT_TYPES:
                        item_outcome = await self.item_state.apply_event(s, envelope)  # type: ignore[arg-type]
                        is_stale = item_outcome.kind == ItemEventKind.STALE
                        await self.workload.apply_delta(s, item_outcome)  # type: ignore[arg-type]
                    await self.activity.record(s, envelope, stream_seq)  # type: ignore[arg-type]
                    await self.inbox.mark_processed(
                        envelope.eventId,
                        self._consumer_name,
                        subject=subject,
                        stream_seq=stream_seq,
                        session=s,  # type: ignore[arg-type]
                    )
                    await self.consumer_state.record_progress(
                        self._consumer_name,
                        stream_seq,
                        datetime.now(UTC),
                        session=s,  # type: ignore[arg-type]
                    )

                await session.with_transaction(body)
            finally:
                await session.end_session()
        except Exception as exc:  # noqa: BLE001 - classified immediately below
            if is_transient_mongo_error(exc):
                return ProcessorResult(
                    Outcome.TRANSIENT_FAILURE, stream_seq, envelope.eventId, envelope.eventType
                )
            await self.failures.record(
                reason_code=ProcessingErrorCode.PROCESSING_BUG,
                detail=f"{type(exc).__name__}: {exc}",
                raw=raw,
                stream_seq=stream_seq,
                event_id=envelope.eventId,
                event_type=envelope.eventType,
                subject=subject,
                num_delivered=num_delivered,
            )
            return ProcessorResult(
                Outcome.POISONED, stream_seq, envelope.eventId, envelope.eventType
            )

        outcome = Outcome.STALE_VERSION if is_stale else Outcome.PROCESSED
        return ProcessorResult(outcome, stream_seq, envelope.eventId, envelope.eventType)

    async def record_redelivery_exhausted(
        self, raw: bytes, stream_seq: int, num_delivered: int
    ) -> None:
        """Called by the consumer loop when a transient failure has
        already consumed the broker's full max_deliver budget for this
        message - the documented terminal/operator-visible path
        (docs/EVENT_CATALOG.md "Durable consumer" table)."""
        event_id = None
        event_type = None
        try:
            envelope = parse_envelope(raw)
            event_id, event_type = envelope.eventId, envelope.eventType
        except Exception:  # noqa: BLE001 - best-effort enrichment only
            pass
        await self.failures.record(
            reason_code=ProcessingErrorCode.REDELIVERY_EXHAUSTED,
            detail=(
                f"Exhausted {num_delivered} delivery attempts with a persistent transient "
                "failure (see application logs around this time for the underlying error)."
            ),
            raw=raw,
            stream_seq=stream_seq,
            event_id=event_id,
            event_type=event_type,
            num_delivered=num_delivered,
        )

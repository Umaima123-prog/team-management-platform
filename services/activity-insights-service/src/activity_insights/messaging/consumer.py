"""EventConsumer: the durable pull-consumer loop.

Binds to (never creates/alters) the `activity-insights-v1` durable
consumer on `TEAM_EVENTS` - that consumer is provisioned idempotently
by the Management Service's StreamBootstrapService (Phase 4); this
service only ever reads from it (docs/ARCHITECTURE.md "Trust
boundary" - Python never owns Management-Service-side infrastructure).

Messages are processed strictly one at a time (no concurrent fetch
processing) - simpler reasoning about the inbox/version-gate race
conditions documented in projections/state.py, and this assignment
does not require high throughput.

Bounded retries for transient failures happen at two layers:
1. A few immediate in-process retries with short backoff (this file).
2. If still failing, `msg.nak()` so the broker redelivers - itself
   bounded by the consumer's own `max_deliver` (provisioned by Phase
   4; see docs/EVENT_CATALOG.md). Once `num_delivered` reaches that
   bound, the message is recorded as a terminal failure and acked
   (see EventProcessor.record_redelivery_exhausted) rather than
   redelivered forever.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

import nats.errors
from nats.js import JetStreamContext

from ..consumer_state import ConsumerStateView
from ..events.subjects import ACTIVITY_INSIGHTS_DURABLE_CONSUMER, TEAM_EVENTS_STREAM_NAME
from .processor import ACK_ELIGIBLE_OUTCOMES, EventProcessor, Outcome

logger = logging.getLogger(__name__)

DEFAULT_FETCH_BATCH = 10
DEFAULT_FETCH_TIMEOUT_S = 5.0
DEFAULT_MAX_DELIVER = 5
IN_PROCESS_RETRY_BACKOFF_S: tuple[float, ...] = (0.2, 1.0)


class EventConsumer:
    def __init__(
        self,
        js: JetStreamContext,
        processor: EventProcessor,
        state_view: ConsumerStateView,
        *,
        durable_name: str = ACTIVITY_INSIGHTS_DURABLE_CONSUMER,
        stream_name: str = TEAM_EVENTS_STREAM_NAME,
        fetch_batch: int = DEFAULT_FETCH_BATCH,
        fetch_timeout_s: float = DEFAULT_FETCH_TIMEOUT_S,
        max_deliver: int = DEFAULT_MAX_DELIVER,
        in_process_retry_backoff_s: tuple[float, ...] = IN_PROCESS_RETRY_BACKOFF_S,
    ) -> None:
        self._js = js
        self._processor = processor
        self._state_view = state_view
        self._durable_name = durable_name
        self._stream_name = stream_name
        self._fetch_batch = fetch_batch
        self._fetch_timeout_s = fetch_timeout_s
        self._max_deliver = max_deliver
        self._in_process_retry_backoff_s = in_process_retry_backoff_s

    async def run_forever(self, stop_event: asyncio.Event) -> None:
        sub = await self._js.pull_subscribe_bind(
            durable=self._durable_name, stream=self._stream_name
        )
        self._state_view.mark_connected(True)
        logger.info(
            "Bound to durable consumer %s on stream %s - entering fetch loop.",
            self._durable_name,
            self._stream_name,
        )
        try:
            while not stop_event.is_set():
                try:
                    msgs = await sub.fetch(self._fetch_batch, timeout=self._fetch_timeout_s)
                except nats.errors.TimeoutError:
                    continue  # no messages available right now - normal idle poll
                except nats.errors.ConnectionClosedError:
                    self._state_view.mark_connected(False)
                    raise

                for msg in msgs:
                    await self.handle_message(msg)
        finally:
            self._state_view.mark_connected(False)

    async def handle_message(self, msg) -> None:  # noqa: ANN001 - nats.aio.msg.Msg
        """Process and ack/nak exactly one delivered message. Public
        (not just used by run_forever's loop) so replay.py's own fetch
        loop against a throwaway consumer can reuse the identical
        ack/retry/poison decision logic - see replay.py."""
        stream_seq = msg.metadata.sequence.stream
        num_delivered = msg.metadata.num_delivered

        result = None
        for attempt, _ in enumerate([*self._in_process_retry_backoff_s, None], start=1):
            result = await self._processor.process(msg.data, stream_seq, num_delivered)
            if result.outcome != Outcome.TRANSIENT_FAILURE:
                break
            if attempt <= len(self._in_process_retry_backoff_s):
                await asyncio.sleep(self._in_process_retry_backoff_s[attempt - 1])

        assert result is not None

        if result.outcome not in ACK_ELIGIBLE_OUTCOMES:
            # Still TRANSIENT_FAILURE after in-process retries.
            if num_delivered >= self._max_deliver:
                await self._processor.record_redelivery_exhausted(
                    msg.data, stream_seq, num_delivered
                )
                await msg.ack()
                logger.error(
                    "Redelivery exhausted (num_delivered=%s) for stream_seq=%s - recorded as a "
                    "terminal processing failure and acked.",
                    num_delivered,
                    stream_seq,
                )
            else:
                delay = min(2**num_delivered, 30)
                await msg.nak(delay=delay)
                logger.warning(
                    "Transient failure processing stream_seq=%s (num_delivered=%s) - nak'd for "
                    "redelivery in %ss.",
                    stream_seq,
                    num_delivered,
                    delay,
                )
            return

        await msg.ack()
        # Advance freshness for every ack-eligible outcome, not just a
        # genuine state mutation: "last successful processing time" is
        # about the consumer being alive and caught up to this stream
        # position, which duplicate/stale/poisoned messages still are.
        self._state_view.mark_processed(stream_seq, datetime.now(UTC))
        logger.info(
            "stream_seq=%s eventId=%s eventType=%s result=%s",
            stream_seq,
            result.event_id,
            result.event_type,
            result.outcome.value,
        )

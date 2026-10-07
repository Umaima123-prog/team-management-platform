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
import nats.js.errors
from nats.js import JetStreamContext

from ..consumer_state import ConsumerStateView
from ..events.subjects import ACTIVITY_INSIGHTS_DURABLE_CONSUMER, TEAM_EVENTS_STREAM_NAME
from .processor import ACK_ELIGIBLE_OUTCOMES, EventProcessor, Outcome

logger = logging.getLogger(__name__)

DEFAULT_FETCH_BATCH = 10
DEFAULT_FETCH_TIMEOUT_S = 5.0
DEFAULT_MAX_DELIVER = 5
IN_PROCESS_RETRY_BACKOFF_S: tuple[float, ...] = (0.2, 1.0)

# Found live in production (Railway): the JetStream API itself can
# answer a pull fetch with a 503 ("no responders"/service unavailable -
# nats.js.errors.ServiceUnavailableError), e.g. briefly after the NATS
# server restarts/redeploys or during a transient broker-side hiccup -
# distinct from the stream/consumer genuinely not existing (that is
# nats.js.errors.NotFoundError, a real configuration problem,
# deliberately left uncaught/fatal below, same as
# ConnectionClosedError). A 503 is explicitly "come back later," not
# fatal, so this is retried with capped exponential backoff rather
# than crashing the process - see run_forever.
DEFAULT_SERVICE_UNAVAILABLE_BACKOFF_S: tuple[float, ...] = (1.0, 2.0, 4.0, 8.0, 16.0, 30.0)


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
        service_unavailable_backoff_s: tuple[float, ...] = DEFAULT_SERVICE_UNAVAILABLE_BACKOFF_S,
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
        self._service_unavailable_backoff_s = service_unavailable_backoff_s

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
        consecutive_service_unavailable = 0
        try:
            while not stop_event.is_set():
                try:
                    msgs = await sub.fetch(self._fetch_batch, timeout=self._fetch_timeout_s)
                except TimeoutError:
                    # Deliberately the builtin TimeoutError, not just
                    # nats.errors.TimeoutError: nats-py's internal
                    # fetch loop (js/client.py's _fetch_n) sometimes
                    # raises the bare builtin directly (e.g. via a
                    # plain `raise asyncio.TimeoutError`, which in
                    # Python 3.11+ *is* the builtin TimeoutError) when
                    # the lingering-request deadline is already
                    # exhausted - not always nats.errors.TimeoutError
                    # (one of its own subclasses). Catching only the
                    # subclass let a real idle-poll timeout escape
                    # uncaught, which propagated through
                    # asyncio.gather() and killed the entire process -
                    # a real crash found live in this phase's manual
                    # verification (see docs/DECISIONS.md #27). The
                    # builtin is a superset catch: it also catches
                    # every nats.errors.TimeoutError instance, since
                    # that class subclasses it.
                    consecutive_service_unavailable = 0
                    continue  # no messages available right now - normal idle poll
                except nats.js.errors.ServiceUnavailableError:
                    # Found live in production: the JetStream API
                    # itself answered the pull with a 503, e.g. a
                    # transient broker-side hiccup or right after NATS
                    # restarts. Explicitly NOT the same as the
                    # stream/durable consumer genuinely not existing
                    # (nats.js.errors.NotFoundError - a real config
                    # problem, left uncaught/fatal, same as
                    # ConnectionClosedError below) - a 503 means "come
                    # back later," so this is logged and retried with
                    # capped exponential backoff, never left to crash
                    # the process. All existing per-message semantics
                    # (explicit ack, inbox dedup, version-gated
                    # projections) are untouched - no message was even
                    # fetched yet.
                    backoff_index = min(
                        consecutive_service_unavailable,
                        len(self._service_unavailable_backoff_s) - 1,
                    )
                    delay = self._service_unavailable_backoff_s[backoff_index]
                    logger.warning(
                        "JetStream API reported ServiceUnavailableError on fetch "
                        "(consecutive=%s) - treating as transient, retrying in %ss.",
                        consecutive_service_unavailable + 1,
                        delay,
                    )
                    consecutive_service_unavailable += 1
                    await asyncio.sleep(delay)
                    continue
                except nats.errors.ConnectionClosedError:
                    self._state_view.mark_connected(False)
                    raise

                consecutive_service_unavailable = 0
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

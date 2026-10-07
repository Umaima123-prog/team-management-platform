import asyncio
from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock

import nats.js.errors
import pytest

from activity_insights.consumer_state import ConsumerStateView
from activity_insights.messaging.consumer import EventConsumer
from activity_insights.messaging.processor import Outcome, ProcessorResult


@dataclass
class _SequencePair:
    stream: int
    consumer: int = 1


class _Metadata:
    def __init__(self, stream_seq: int, num_delivered: int) -> None:
        self.sequence = _SequencePair(stream_seq)
        self.num_delivered = num_delivered


def _fake_msg(stream_seq: int = 1, num_delivered: int = 1) -> MagicMock:
    msg = MagicMock()
    msg.data = b"raw"
    msg.metadata = _Metadata(stream_seq, num_delivered)
    msg.ack = AsyncMock()
    msg.nak = AsyncMock()
    return msg


def _consumer(processor: AsyncMock, **kwargs: object) -> EventConsumer:
    return EventConsumer(
        js=MagicMock(),
        processor=processor,
        state_view=ConsumerStateView("test-consumer"),
        in_process_retry_backoff_s=(0.0, 0.0),
        **kwargs,
    )


@pytest.mark.asyncio
async def test_processed_message_is_acked() -> None:
    processor = AsyncMock()
    processor.process.return_value = ProcessorResult(Outcome.PROCESSED, 1, "evt-1", "team.created")
    consumer = _consumer(processor)
    msg = _fake_msg()

    await consumer.handle_message(msg)

    msg.ack.assert_awaited_once()
    msg.nak.assert_not_called()
    assert processor.process.await_count == 1


@pytest.mark.asyncio
async def test_poisoned_message_is_still_acked_so_it_is_never_redelivered() -> None:
    processor = AsyncMock()
    processor.process.return_value = ProcessorResult(Outcome.POISONED, 1, "evt-1", "workitem.x")
    consumer = _consumer(processor)
    msg = _fake_msg()

    await consumer.handle_message(msg)

    msg.ack.assert_awaited_once()
    msg.nak.assert_not_called()


@pytest.mark.asyncio
async def test_transient_failure_is_retried_in_process_then_nakd_if_still_failing() -> None:
    processor = AsyncMock()
    processor.process.return_value = ProcessorResult(Outcome.TRANSIENT_FAILURE, 1)
    consumer = _consumer(processor, max_deliver=5)
    msg = _fake_msg(num_delivered=1)

    await consumer.handle_message(msg)

    # 1 initial attempt + 2 backoff slots configured in _consumer() = 3 total.
    assert processor.process.await_count == 3
    msg.nak.assert_awaited_once()
    msg.ack.assert_not_called()


@pytest.mark.asyncio
async def test_transient_failure_recovers_on_an_in_process_retry() -> None:
    processor = AsyncMock()
    processor.process.side_effect = [
        ProcessorResult(Outcome.TRANSIENT_FAILURE, 1),
        ProcessorResult(Outcome.PROCESSED, 1, "evt-1", "team.created"),
    ]
    consumer = _consumer(processor)
    msg = _fake_msg()

    await consumer.handle_message(msg)

    assert processor.process.await_count == 2
    msg.ack.assert_awaited_once()
    msg.nak.assert_not_called()


@pytest.mark.asyncio
async def test_redelivery_exhausted_records_failure_and_acks_instead_of_looping_forever() -> None:
    processor = AsyncMock()
    processor.process.return_value = ProcessorResult(Outcome.TRANSIENT_FAILURE, 1)
    consumer = _consumer(processor, max_deliver=3)
    msg = _fake_msg(num_delivered=3)  # already at the broker's max_deliver bound

    await consumer.handle_message(msg)

    processor.record_redelivery_exhausted.assert_awaited_once()
    msg.ack.assert_awaited_once()
    msg.nak.assert_not_called()


@pytest.mark.asyncio
async def test_run_forever_survives_a_raw_builtin_timeout_error_from_an_idle_fetch() -> None:
    """Regression test for a real crash found live in Phase 6's manual
    verification: nats-py's internal fetch loop sometimes raises the
    bare builtin TimeoutError directly (not always the
    nats.errors.TimeoutError subclass) when a fetch genuinely finds no
    messages. The old `except nats.errors.TimeoutError` clause let that
    escape uncaught, which propagated through asyncio.gather() in
    main.py and killed the entire process - see
    docs/DECISIONS.md #27."""
    processor = AsyncMock()
    stop_event = asyncio.Event()
    call_count = 0

    async def fetch(*_args: object, **_kwargs: object) -> list[object]:
        nonlocal call_count
        call_count += 1
        if call_count >= 2:
            stop_event.set()
        raise TimeoutError("no messages available")  # the raw builtin, not a nats.errors subclass

    sub = MagicMock()
    sub.fetch = fetch
    js = MagicMock()
    js.pull_subscribe_bind = AsyncMock(return_value=sub)

    consumer = EventConsumer(js=js, processor=processor, state_view=ConsumerStateView("test"))

    await consumer.run_forever(stop_event)  # must return normally - never raise

    assert call_count >= 2
    processor.process.assert_not_called()


@pytest.mark.asyncio
async def test_run_forever_survives_a_transient_service_unavailable_error_and_keeps_polling() -> (
    None
):
    """Regression test for a real crash found live on Railway: the
    JetStream API answered a pull fetch with a 503
    (nats.js.errors.ServiceUnavailableError) - e.g. a transient
    broker-side hiccup - which was not caught at all, so it propagated
    through asyncio.gather() in main.py and killed the whole process.
    This must now be treated as transient: logged, retried with
    backoff, and the fetch loop must keep going - never crash, and
    never skip straight to processing a message that was never
    fetched (inbox/ack semantics for real messages are untouched by
    this path)."""
    processor = AsyncMock()
    stop_event = asyncio.Event()
    call_count = 0

    async def fetch(*_args: object, **_kwargs: object) -> list[object]:
        nonlocal call_count
        call_count += 1
        if call_count >= 3:
            stop_event.set()
        raise nats.js.errors.ServiceUnavailableError()

    sub = MagicMock()
    sub.fetch = fetch
    js = MagicMock()
    js.pull_subscribe_bind = AsyncMock(return_value=sub)

    consumer = EventConsumer(
        js=js,
        processor=processor,
        state_view=ConsumerStateView("test"),
        # Near-zero so the test doesn't actually wait through the real
        # (1.0, 2.0, 4.0, ...) production backoff schedule.
        service_unavailable_backoff_s=(0.0, 0.0, 0.0),
    )

    await consumer.run_forever(stop_event)  # must return normally - never raise

    assert call_count >= 3
    processor.process.assert_not_called()  # no message was ever actually fetched


@pytest.mark.asyncio
async def test_run_forever_does_not_swallow_a_permanent_notfound_error() -> None:
    """The stream/durable consumer genuinely not existing raises
    nats.js.errors.NotFoundError - a sibling of ServiceUnavailableError
    under APIError, not a subclass of it, so the ServiceUnavailableError
    handler must not catch it. A real configuration problem like this
    must still surface (and crash, same as ConnectionClosedError),
    never be silently retried forever as if it were transient."""
    processor = AsyncMock()
    stop_event = asyncio.Event()

    async def fetch(*_args: object, **_kwargs: object) -> list[object]:
        raise nats.js.errors.NotFoundError("consumer not found")

    sub = MagicMock()
    sub.fetch = fetch
    js = MagicMock()
    js.pull_subscribe_bind = AsyncMock(return_value=sub)

    consumer = EventConsumer(js=js, processor=processor, state_view=ConsumerStateView("test"))

    with pytest.raises(nats.js.errors.NotFoundError):
        await consumer.run_forever(stop_event)

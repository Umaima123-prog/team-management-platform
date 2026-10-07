from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock

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

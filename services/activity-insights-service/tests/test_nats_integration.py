"""REAL local NATS JetStream integration suite - no mocks on the
messaging side (assignment: "at least one automated integration suite
using the REAL local Docker NATS JetStream server").

Mirrors the Management Service's own
test/nats-integration.e2e-spec.ts: requires `docker compose up -d nats`
at the repo root and genuinely FAILS (not a silent skip) if nothing is
listening on NATS_URL.

Unlike that suite, this one does NOT touch the real `TEAM_EVENTS`
stream or the assignment-mandated `activity-insights-v1` durable
consumer - each test creates (and tears down) its own throwaway
stream/consumer so this automated suite stays reproducible and never
permanently consumes the shared backlog that the live service is
actually meant to process. (Separately, as part of this phase's live
verification, the real service WAS run against the real TEAM_EVENTS
stream and real Atlas - see the final report, not this file.)

MongoDB is intentionally not exercised here either (same reasoning as
the TS suite: a reachable Mongo is an external dependency this
automated suite should not require to stay reproducible everywhere -
see docs/TIMELOG.md "preserve lessons" / "reproducible dependencies").
A `_FakeProcessor` stands in for `EventProcessor` - the thing actually
under test here (real JetStream bind/fetch/ack/nak/redelivery via the
real `EventConsumer` class) is 100% real.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime

import nats
import pytest
from nats.js.api import AckPolicy, ConsumerConfig, DeliverPolicy

from activity_insights.consumer_state import ConsumerStateView
from activity_insights.messaging.consumer import EventConsumer
from activity_insights.messaging.processor import Outcome, ProcessorResult

NATS_URL = "nats://localhost:4222"


class _FakeProcessor:
    def __init__(self, outcomes: list[Outcome] | None = None) -> None:
        self.calls: list[tuple[int, int]] = []
        self._outcomes = list(outcomes) if outcomes else []
        self.exhausted_calls = 0

    async def process(self, raw: bytes, stream_seq: int, num_delivered: int) -> ProcessorResult:
        self.calls.append((stream_seq, num_delivered))
        outcome = self._outcomes.pop(0) if self._outcomes else Outcome.PROCESSED
        return ProcessorResult(outcome, stream_seq)

    async def record_redelivery_exhausted(
        self, raw: bytes, stream_seq: int, num_delivered: int
    ) -> None:
        self.exhausted_calls += 1


async def _connect_with_throwaway_stream():
    # Fails loudly (not a silent skip) if Docker NATS is not running -
    # see module docstring.
    nc = await nats.connect(NATS_URL, connect_timeout=5)
    jsm = nc.jetstream()
    suffix = uuid.uuid4().hex[:8]
    stream_name = f"TEST_AI_{suffix}".upper()
    subject = f"test.ai.{suffix}.event"
    await jsm.add_stream(name=stream_name, subjects=[subject])
    return nc, jsm, stream_name, subject


async def _consumer_info_settled(
    jsm, stream_name: str, consumer_name: str, *, timeout: float = 2.0
):
    """`msg.ack()` (used by EventConsumer in production for throughput)
    does not wait for the server's ack to be durably reflected in
    consumer_info - poll briefly rather than asserting against a
    genuinely racy single read."""
    deadline = asyncio.get_event_loop().time() + timeout
    info = await jsm.consumer_info(stream_name, consumer_name)
    while info.num_ack_pending != 0 and asyncio.get_event_loop().time() < deadline:
        await asyncio.sleep(0.1)
        info = await jsm.consumer_info(stream_name, consumer_name)
    return info


def _envelope_bytes(event_id: str) -> bytes:
    doc = {
        "eventId": event_id,
        "eventType": "team.created",
        "schemaVersion": 1,
        "occurredAt": datetime.now(UTC).isoformat(),
        "producer": "management-service",
        "workspaceId": "ws_1",
        "aggregate": {"type": "Team", "id": "team_1", "version": 1},
        "correlationId": "corr_1",
        "causationId": None,
        "actorId": "user_1",
        "payload": {"code": "ENG", "name": "Engineering"},
    }
    return json.dumps(doc).encode("utf-8")


@pytest.mark.asyncio
async def test_real_jetstream_publish_fetch_and_ack() -> None:
    nc, jsm, stream_name, subject = await _connect_with_throwaway_stream()
    try:
        js = nc.jetstream()
        ack = await js.publish(subject, _envelope_bytes("evt-real-1"), timeout=5)
        assert ack.seq >= 1

        consumer_name = "test-consumer"
        await jsm.add_consumer(
            stream_name,
            config=ConsumerConfig(
                durable_name=consumer_name,
                ack_policy=AckPolicy.EXPLICIT,
                deliver_policy=DeliverPolicy.ALL,
                max_deliver=5,
            ),
        )

        processor = _FakeProcessor()
        consumer = EventConsumer(
            js,
            processor,
            ConsumerStateView(consumer_name),
            durable_name=consumer_name,
            stream_name=stream_name,
            fetch_timeout_s=3,
        )
        sub = await js.pull_subscribe_bind(durable=consumer_name, stream=stream_name)
        msgs = await sub.fetch(1, timeout=3)
        assert len(msgs) == 1

        await consumer.handle_message(msgs[0])

        assert processor.calls == [(ack.seq, 1)]

        info = await _consumer_info_settled(jsm, stream_name, consumer_name)
        assert info.num_ack_pending == 0
        assert info.num_pending == 0
    finally:
        try:
            await jsm.delete_stream(stream_name)
        except Exception:
            pass
        await nc.close()


@pytest.mark.asyncio
async def test_real_redelivery_after_nak_increments_num_delivered() -> None:
    nc, jsm, stream_name, subject = await _connect_with_throwaway_stream()
    try:
        js = nc.jetstream()
        ack = await js.publish(subject, _envelope_bytes("evt-real-2"), timeout=5)
        assert ack.seq >= 1

        consumer_name = "test-consumer-redeliver"
        await jsm.add_consumer(
            stream_name,
            config=ConsumerConfig(
                durable_name=consumer_name,
                ack_policy=AckPolicy.EXPLICIT,
                deliver_policy=DeliverPolicy.ALL,
                max_deliver=5,
                ack_wait=1,  # seconds - short so this test doesn't have to wait long
                backoff=[1],  # seconds
            ),
        )

        processor = _FakeProcessor(outcomes=[Outcome.TRANSIENT_FAILURE])
        consumer = EventConsumer(
            js,
            processor,
            ConsumerStateView(consumer_name),
            durable_name=consumer_name,
            stream_name=stream_name,
            fetch_timeout_s=3,
            in_process_retry_backoff_s=(),
        )
        sub = await js.pull_subscribe_bind(durable=consumer_name, stream=stream_name)
        msgs = await sub.fetch(1, timeout=3)
        await consumer.handle_message(msgs[0])  # transient -> nak'd (num_delivered was 1)

        # Wait past ack_wait/backoff for the REAL broker to redeliver -
        # this is the actual thing under test, not simulated.
        msgs2 = await sub.fetch(1, timeout=5)
        assert len(msgs2) == 1
        assert msgs2[0].metadata.num_delivered == 2
        await msgs2[0].ack()
    finally:
        try:
            await jsm.delete_stream(stream_name)
        except Exception:
            pass
        await nc.close()


@pytest.mark.asyncio
async def test_real_redelivery_exhaustion_is_recorded_and_acked() -> None:
    nc, jsm, stream_name, subject = await _connect_with_throwaway_stream()
    try:
        js = nc.jetstream()
        await js.publish(subject, _envelope_bytes("evt-real-3"), timeout=5)

        consumer_name = "test-consumer-exhaust"
        max_deliver = 2
        await jsm.add_consumer(
            stream_name,
            config=ConsumerConfig(
                durable_name=consumer_name,
                ack_policy=AckPolicy.EXPLICIT,
                deliver_policy=DeliverPolicy.ALL,
                max_deliver=max_deliver,
                ack_wait=1,
                backoff=[1],
            ),
        )

        processor = _FakeProcessor(outcomes=[Outcome.TRANSIENT_FAILURE, Outcome.TRANSIENT_FAILURE])
        consumer = EventConsumer(
            js,
            processor,
            ConsumerStateView(consumer_name),
            durable_name=consumer_name,
            stream_name=stream_name,
            fetch_timeout_s=3,
            max_deliver=max_deliver,
            in_process_retry_backoff_s=(),
        )
        sub = await js.pull_subscribe_bind(durable=consumer_name, stream=stream_name)

        first = await sub.fetch(1, timeout=3)
        await consumer.handle_message(first[0])  # num_delivered=1, nak'd

        second = await sub.fetch(1, timeout=5)
        assert second[0].metadata.num_delivered == max_deliver
        await consumer.handle_message(second[0])  # at the bound -> exhausted, acked

        assert processor.exhausted_calls == 1

        info = await _consumer_info_settled(jsm, stream_name, consumer_name)
        assert info.num_pending == 0
        assert info.num_ack_pending == 0
    finally:
        try:
            await jsm.delete_stream(stream_name)
        except Exception:
            pass
        await nc.close()

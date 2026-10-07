"""One-off backfill: fills in `issueKey` on `item_state` documents
that were projected before issueKey capture existed on
`workitem.created` (docs/DECISIONS.md #30 - the admin UI's Activity
panel was found, via the user's own manual Chrome verification, still
showing raw WorkItem ids for items created before that fix landed).

Deliberately a script, never an HTTP endpoint - same rule as
replay.py ("do not expose unsafe public replay/admin endpoints"), and
this needs an operator present to run it and read the summary, not an
unauthenticated route:

    python -m activity_insights.backfill

What it does, concretely:

1. Creates (or reuses, on a second run) a durable JetStream consumer
   on the real `TEAM_EVENTS` stream, filtered to *only* the
   `tm.v1.workitem.created` subject, with `deliver_policy=all` - full
   history, from the beginning. This is a separate consumer from the
   assignment-mandated `activity-insights-v1` (never touched here -
   see messaging/consumer.py) and from any replay.py run; it is never
   bound to the live service's processing path.
2. For each `workitem.created` event, reads the real `issueKey` out of
   that event's own payload (the only place it is ever carried - see
   projections/state.py's `_fields_for_event`) and calls
   `ItemStateRepository.backfill_issue_key`, which only ever *sets* a
   currently-missing issueKey on a document that already exists -
   never creates a document, never overwrites one, never touches any
   other field. No value is invented: every issueKey written here
   came from a real `workitem.created` event that already happened.
3. Only ever reads/writes `insights_db` (via the exact same
   `ItemStateRepository` the live consumer uses) - never
   management_db, and never widens scope to any other projection.
4. Stops once a fetch times out with nothing pending (caught up),
   acks every message it processed, then deletes its own throwaway
   consumer - this is a one-shot repair tool, not a standing
   subscription, so it should not linger on the stream between runs.

Idempotent and safe to run multiple times, or re-run after the live
consumer has processed more events: a document that already has its
issueKey is always left untouched (see backfill_issue_key), and this
never races with or duplicates the live `activity-insights-v1`
consumer's own, separate processing of the same events.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

import nats.js.errors
from nats.js.api import AckPolicy, ConsumerConfig, DeliverPolicy

from .config import get_settings
from .db import database_from_client, get_client
from .events.envelope import EventEnvelope, parse_envelope
from .events.subjects import TEAM_EVENTS_STREAM_NAME, subject_for_event_type
from .logging_config import configure_logging
from .nats_client import connect
from .projections.state import ItemStateRepository

logger = logging.getLogger(__name__)

BACKFILL_CONSUMER_NAME = "activity-insights-backfill-issue-keys"
_CREATED_SUBJECT = subject_for_event_type("workitem.created")


async def apply_backfill_event(item_state: ItemStateRepository, envelope: EventEnvelope) -> bool:
    """The actual per-event decision, pulled out of the NATS fetch loop
    so it is unit-testable without a real broker (see
    tests/test_backfill.py). Returns whether a document was updated."""
    issue_key = envelope.payload.get("issueKey")
    if not isinstance(issue_key, str) or not issue_key:
        return False
    return await item_state.backfill_issue_key(envelope.aggregate.id, issue_key)


@dataclass
class BackfillSummary:
    events_seen: int
    documents_updated: int


async def _ensure_backfill_consumer(js, consumer_name: str) -> None:
    try:
        await js.consumer_info(TEAM_EVENTS_STREAM_NAME, consumer_name)
        logger.info("Reusing existing backfill consumer %s.", consumer_name)
        return
    except nats.js.errors.NotFoundError:
        pass
    await js.add_consumer(
        TEAM_EVENTS_STREAM_NAME,
        config=ConsumerConfig(
            durable_name=consumer_name,
            ack_policy=AckPolicy.EXPLICIT,
            deliver_policy=DeliverPolicy.ALL,
            filter_subject=_CREATED_SUBJECT,
            max_deliver=5,
        ),
    )
    logger.info(
        "Created new backfill consumer %s (deliver_policy=all, filter_subject=%s).",
        consumer_name,
        _CREATED_SUBJECT,
    )


async def run_backfill(
    consumer_name: str = BACKFILL_CONSUMER_NAME, *, idle_timeout_s: float = 5.0
) -> BackfillSummary:
    settings = get_settings()
    client = get_client(settings)
    db = database_from_client(client, settings)
    item_state = ItemStateRepository(db)

    nc, js = await connect(settings)
    await _ensure_backfill_consumer(js, consumer_name)
    sub = await js.pull_subscribe_bind(durable=consumer_name, stream=TEAM_EVENTS_STREAM_NAME)

    seen = 0
    updated = 0
    try:
        while True:
            try:
                msgs = await sub.fetch(10, timeout=idle_timeout_s)
            except TimeoutError:
                # The builtin, not just nats.errors.TimeoutError - see
                # messaging/consumer.py's run_forever (docs/
                # DECISIONS.md #27).
                break  # caught up - no more history pending for this consumer
            for msg in msgs:
                seen += 1
                try:
                    envelope = parse_envelope(msg.data)
                except Exception:
                    logger.exception("Skipping unparseable message during backfill.")
                    await msg.ack()
                    continue
                if await apply_backfill_event(item_state, envelope):
                    updated += 1
                await msg.ack()
    finally:
        try:
            await js.delete_consumer(TEAM_EVENTS_STREAM_NAME, consumer_name)
        finally:
            await nc.close()

    return BackfillSummary(events_seen=seen, documents_updated=updated)


def main() -> None:
    configure_logging(get_settings().log_level)
    summary = asyncio.run(run_backfill())
    print(
        f"Backfill complete: workitem.created events seen={summary.events_seen} "
        f"item_state documents updated={summary.documents_updated}"
    )


if __name__ == "__main__":
    main()

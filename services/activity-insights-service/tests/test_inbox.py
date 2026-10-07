"""InboxRepository: the (event_id, consumer) uniqueness backstop.

tests/test_processor.py's `test_duplicate_event_is_not_reprocessed`
already covers the *normal* path (a read-before-write `already_processed`
check skips reprocessing). This file covers the *other* line of defense
the module's own docstring calls out: the unique index itself
(index_bootstrap.py), modeled here via tests/support/fake_mongo.py's
`declare_unique`/`DuplicateKeyError` enforcement - e.g. the scenario of
a second instance of this service racing the same event past the
in-process check.
"""

from __future__ import annotations

import pytest
from pymongo.errors import DuplicateKeyError

from activity_insights.inbox.repository import InboxRepository
from support.fake_mongo import FakeDatabase


@pytest.mark.asyncio
async def test_already_processed_is_false_before_and_true_after_marking() -> None:
    db = FakeDatabase()
    repo = InboxRepository(db)

    assert await repo.already_processed("evt-1", "consumer-a") is False

    await repo.mark_processed("evt-1", "consumer-a", subject="tm.v1.team.created", stream_seq=1)

    assert await repo.already_processed("evt-1", "consumer-a") is True


@pytest.mark.asyncio
async def test_same_event_id_for_a_different_consumer_is_independent() -> None:
    """(event_id, consumer) is a compound key - two different durable
    consumers each get their own dedup record for the same event."""
    db = FakeDatabase()
    repo = InboxRepository(db)

    await repo.mark_processed("evt-1", "consumer-a", subject="tm.v1.team.created", stream_seq=1)

    assert await repo.already_processed("evt-1", "consumer-b") is False


@pytest.mark.asyncio
async def test_unique_index_rejects_a_duplicate_insert_as_a_backstop() -> None:
    """Models the scenario the module docstring names: the in-process
    `already_processed` read is skipped/raced (e.g. a second instance
    of this service running by mistake) and `mark_processed` is called
    twice for the same (event_id, consumer) - the unique index must
    reject the second write rather than silently double-record it."""
    db = FakeDatabase()
    db["inbox"].declare_unique("event_id", "consumer")
    repo = InboxRepository(db)

    await repo.mark_processed("evt-1", "consumer-a", subject="tm.v1.team.created", stream_seq=1)

    with pytest.raises(DuplicateKeyError):
        await repo.mark_processed(
            "evt-1", "consumer-a", subject="tm.v1.team.created", stream_seq=2
        )


@pytest.mark.asyncio
async def test_namespace_prefixes_the_collection_so_a_replay_never_touches_the_live_inbox() -> None:
    db = FakeDatabase()
    live = InboxRepository(db)
    replay = InboxRepository(db, namespace="test_replay_")

    await replay.mark_processed("evt-1", "consumer-a", subject="tm.v1.team.created", stream_seq=1)

    assert await live.already_processed("evt-1", "consumer-a") is False
    assert await replay.already_processed("evt-1", "consumer-a") is True

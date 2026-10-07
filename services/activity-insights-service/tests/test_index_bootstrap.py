from unittest.mock import AsyncMock, MagicMock

import pytest

from activity_insights.collections import (
    ACTIVITY_PROJECTION_COLLECTION,
    INBOX_COLLECTION,
    WORKLOAD_PROJECTION_COLLECTION,
)
from activity_insights.index_bootstrap import bootstrap_indexes, bootstrap_namespaced_indexes


def _fake_db() -> tuple[MagicMock, AsyncMock]:
    fake_collection = AsyncMock()
    fake_db = MagicMock()
    fake_db.__getitem__.return_value = fake_collection
    return fake_db, fake_collection


@pytest.mark.asyncio
async def test_creates_unique_compound_index_on_inbox_event_id_and_consumer() -> None:
    fake_db, fake_collection = _fake_db()

    await bootstrap_indexes(fake_db)

    fake_db.__getitem__.assert_any_call(INBOX_COLLECTION)
    # drop_index (legacy index removal) + create_indexes (new compound index).
    fake_collection.drop_index.assert_awaited_once()
    assert fake_collection.create_indexes.await_count >= 1
    inbox_call = fake_collection.create_indexes.await_args_list[0]
    (indexes,) = inbox_call.args
    assert dict(indexes[0].document["key"]) == {"event_id": 1, "consumer": 1}
    assert indexes[0].document["unique"] is True


@pytest.mark.asyncio
async def test_creates_activity_projection_and_workload_projection_indexes() -> None:
    fake_db, fake_collection = _fake_db()

    await bootstrap_indexes(fake_db)

    fake_db.__getitem__.assert_any_call(ACTIVITY_PROJECTION_COLLECTION)
    fake_db.__getitem__.assert_any_call(WORKLOAD_PROJECTION_COLLECTION)
    # One create_indexes call per collection: inbox, activity_projection, workload_projection.
    assert fake_collection.create_indexes.await_count == 3


@pytest.mark.asyncio
async def test_does_not_raise_when_index_creation_fails() -> None:
    fake_collection = AsyncMock()
    fake_collection.create_indexes.side_effect = ConnectionError("boom")
    fake_db = MagicMock()
    fake_db.__getitem__.return_value = fake_collection

    await bootstrap_indexes(fake_db)  # must not raise


@pytest.mark.asyncio
async def test_namespaced_bootstrap_targets_prefixed_collection_names() -> None:
    fake_db, fake_collection = _fake_db()

    await bootstrap_namespaced_indexes(fake_db, "replay1_")

    fake_db.__getitem__.assert_any_call(f"replay1_{INBOX_COLLECTION}")
    fake_db.__getitem__.assert_any_call(f"replay1_{ACTIVITY_PROJECTION_COLLECTION}")
    fake_db.__getitem__.assert_any_call(f"replay1_{WORKLOAD_PROJECTION_COLLECTION}")

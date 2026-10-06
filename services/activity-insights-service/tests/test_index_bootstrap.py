from unittest.mock import AsyncMock, MagicMock

import pytest

from activity_insights.collections import INBOX_COLLECTION
from activity_insights.index_bootstrap import bootstrap_indexes


@pytest.mark.asyncio
async def test_creates_unique_index_on_inbox_event_id() -> None:
    fake_collection = AsyncMock()
    fake_db = MagicMock()
    fake_db.__getitem__.return_value = fake_collection

    await bootstrap_indexes(fake_db)

    fake_db.__getitem__.assert_called_once_with(INBOX_COLLECTION)
    fake_collection.create_indexes.assert_awaited_once()


@pytest.mark.asyncio
async def test_does_not_raise_when_index_creation_fails() -> None:
    fake_collection = AsyncMock()
    fake_collection.create_indexes.side_effect = ConnectionError("boom")
    fake_db = MagicMock()
    fake_db.__getitem__.return_value = fake_collection

    await bootstrap_indexes(fake_db)  # must not raise

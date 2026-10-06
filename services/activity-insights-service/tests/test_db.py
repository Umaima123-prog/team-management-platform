import pytest

from activity_insights.config import Settings
from activity_insights.db import get_client, get_database, ping


def _settings(**overrides: object) -> Settings:
    base = {
        "_env_file": None,
        "MONGODB_URI": "mongodb://127.0.0.1:27017",
        "MONGODB_DB_NAME": "insights_db",
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def test_get_client_requires_uri() -> None:
    with pytest.raises(RuntimeError, match="MONGODB_URI"):
        get_client(_settings(MONGODB_URI=""))


def test_get_database_refuses_management_db() -> None:
    with pytest.raises(RuntimeError, match="insights_db"):
        get_database(_settings(MONGODB_DB_NAME="management_db"))


def test_get_database_returns_insights_db() -> None:
    db = get_database(_settings())
    assert db.name == "insights_db"


@pytest.mark.asyncio
async def test_ping_returns_false_when_unreachable() -> None:
    db = get_database(_settings())
    assert await ping(db) is False

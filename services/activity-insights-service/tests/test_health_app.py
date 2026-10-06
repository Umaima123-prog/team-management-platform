from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from activity_insights.health_app import app, get_db


def test_healthz_never_touches_the_database() -> None:
    with TestClient(app) as client:
        response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "activity-insights-service"}


def test_readyz_ok_when_db_reachable() -> None:
    fake_db = AsyncMock()
    fake_db.name = "insights_db"
    fake_db.command = AsyncMock(return_value={"ok": 1})
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        with TestClient(app) as client:
            response = client.get("/readyz")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "insights_db"}


def test_readyz_503_when_db_unreachable() -> None:
    fake_db = AsyncMock()
    fake_db.name = "insights_db"
    fake_db.command = AsyncMock(side_effect=ConnectionError("boom"))
    app.dependency_overrides[get_db] = lambda: fake_db

    try:
        with TestClient(app) as client:
            response = client.get("/readyz")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503

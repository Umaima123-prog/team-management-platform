from activity_insights.config import Settings


def test_defaults_point_at_insights_db() -> None:
    settings = Settings(_env_file=None)
    assert settings.mongodb_db_name == "insights_db"

"""Environment-based settings. No real secrets ever live in this file."""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = Field(default="development", alias="ENVIRONMENT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    health_port: int = Field(default=8001, alias="HEALTH_PORT")

    mongodb_uri: str = Field(default="", alias="MONGODB_URI")
    mongodb_db_name: str = Field(default="insights_db", alias="MONGODB_DB_NAME")

    nats_url: str = Field(default="nats://localhost:4222", alias="NATS_URL")
    nats_durable_consumer_name: str = Field(
        default="activity-insights-service", alias="NATS_DURABLE_CONSUMER_NAME"
    )


def get_settings() -> Settings:
    return Settings()

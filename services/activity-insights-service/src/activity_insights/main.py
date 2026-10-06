"""Service entrypoint.

Phase 2 scope: load config, configure logging, and serve the
liveness/readiness HTTP app (health_app.py) backed by insights_db.
Event consumption (JetStream), inbox persistence, and projections are
not implemented yet - see docs/ARCHITECTURE.md for the target design.
"""

from __future__ import annotations

import logging

import uvicorn

from .config import get_settings
from .logging_config import configure_logging

logger = logging.getLogger(__name__)


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    logger.info(
        "activity-insights-service starting (env=%s, db=%s)",
        settings.environment,
        settings.mongodb_db_name,
    )
    uvicorn.run(
        "activity_insights.health_app:app",
        host="0.0.0.0",  # noqa: S104 - local/dev container port, not internet-facing
        port=settings.health_port,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    main()

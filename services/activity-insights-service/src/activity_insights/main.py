"""Service entrypoint.

Phase 1 scope: load config, configure logging, and expose a liveness
check. Event consumption, inbox persistence, and projections are not
implemented yet - see docs/ARCHITECTURE.md for the target design.
"""

from __future__ import annotations

import logging

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


if __name__ == "__main__":
    main()

"""Processing-error classification - the Python mirror of the
Management Service's src/messaging/relay/retry-policy.ts.

Only a Mongo-connectivity-shaped failure is treated as transient
(retryable): a server selection timeout, a dropped connection, a
network timeout. Everything else (a programming bug, an unexpected
data shape that slipped past envelope validation, etc.) is treated as
non-retryable - retrying those can never succeed and would just loop
forever consuming redelivery budget.
"""

from __future__ import annotations

from pymongo.errors import (
    AutoReconnect,
    ConnectionFailure,
    NetworkTimeout,
    ServerSelectionTimeoutError,
)

TRANSIENT_MONGO_ERRORS: tuple[type[BaseException], ...] = (
    AutoReconnect,
    ConnectionFailure,
    NetworkTimeout,
    ServerSelectionTimeoutError,
)


def is_transient_mongo_error(exc: BaseException) -> bool:
    return isinstance(exc, TRANSIENT_MONGO_ERRORS)


class ProcessingErrorCode:
    SCHEMA_INVALID = "SCHEMA_INVALID"
    UNSUPPORTED_SCHEMA_VERSION = "UNSUPPORTED_SCHEMA_VERSION"
    UNKNOWN_EVENT_TYPE = "UNKNOWN_EVENT_TYPE"
    REDELIVERY_EXHAUSTED = "REDELIVERY_EXHAUSTED"
    PROCESSING_BUG = "PROCESSING_BUG"

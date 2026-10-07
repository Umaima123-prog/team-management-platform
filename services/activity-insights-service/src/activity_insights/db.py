"""MongoDB connection helper.

This service connects ONLY to insights_db. It must never open a
connection to management_db or read Management Service collections.
There is no hardcoded connection string anywhere in this module -
MONGODB_URI must come from the environment (.env locally, real
secrets in deployment). Tests pass their own Settings overrides
instead of relying on any default baked in here.
"""

from __future__ import annotations

import logging

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from .config import Settings

logger = logging.getLogger(__name__)

EXPECTED_DB_NAME = "insights_db"

# Fails fast (and loudly, in CI/startup) rather than silently connecting
# to the wrong database if MONGODB_DB_NAME is ever misconfigured to
# point at management_db.
_SERVER_SELECTION_TIMEOUT_MS = 2000


def get_client(settings: Settings) -> AsyncIOMotorClient:
    if not settings.mongodb_uri:
        raise RuntimeError(
            "MONGODB_URI is not set. Copy .env.example to .env and configure it."
        )
    return AsyncIOMotorClient(
        settings.mongodb_uri,
        serverSelectionTimeoutMS=_SERVER_SELECTION_TIMEOUT_MS,
    )


def database_from_client(client: AsyncIOMotorClient, settings: Settings) -> AsyncIOMotorDatabase:
    """Same insights_db-only guard as get_database(), but reuses a
    client the caller already has - required whenever a `db[...]`
    collection and a `client.start_session()` session will be used
    together (a Mongo session is only valid against the exact client
    instance that created it; mixing clients raises
    `InvalidOperation: Can only use session with the MongoClient that
    started it` - a real bug hit and fixed during Phase 5's first live
    run, see docs/TIMELOG.md)."""
    if settings.mongodb_db_name != EXPECTED_DB_NAME:
        raise RuntimeError(
            f"Refusing to connect: MONGODB_DB_NAME={settings.mongodb_db_name!r}, "
            f"but this service may only ever use {EXPECTED_DB_NAME!r}."
        )
    return client[settings.mongodb_db_name]


def get_database(settings: Settings) -> AsyncIOMotorDatabase:
    """Convenience for callers that only need a database handle, not a
    session on the same client (e.g. the FastAPI health app's
    per-request dependency). Callers that will ALSO start a session
    against this database (the consumer, the responder, replay.py)
    must instead call get_client() once and pass that same client to
    both database_from_client() and client.start_session() - see
    main.py / replay.py."""
    client = get_client(settings)
    return database_from_client(client, settings)


def create_insights_db(settings: Settings) -> AsyncIOMotorDatabase:
    """Backwards-compatible alias for get_database."""
    return get_database(settings)


async def ping(db: AsyncIOMotorDatabase) -> bool:
    try:
        await db.command("ping")
        return True
    except Exception as exc:  # noqa: BLE001 - deliberately broad: any failure means "not ready"
        # Never log the connection string or credentials. codeName/errmsg
        # on a MongoDB OperationFailure are fixed, generic server strings
        # (e.g. "AtlasError" / "bad auth : Authentication failed.") that
        # never reflect the client's secret input, so they're safe to log.
        details = getattr(exc, "details", None) or {}
        code_name = details.get("codeName")
        errmsg = details.get("errmsg")
        extra = f" {code_name}: {errmsg}" if code_name or errmsg else ""
        logger.warning("MongoDB ping failed (%s)%s", type(exc).__name__, extra)
        return False

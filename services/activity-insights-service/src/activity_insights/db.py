"""MongoDB connection helper.

This service connects ONLY to insights_db. It must never open a
connection to management_db or read Management Service collections.
"""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from .config import Settings


def create_insights_db(settings: Settings) -> AsyncIOMotorDatabase:
    client: AsyncIOMotorClient = AsyncIOMotorClient(settings.mongodb_uri)
    return client[settings.mongodb_db_name]

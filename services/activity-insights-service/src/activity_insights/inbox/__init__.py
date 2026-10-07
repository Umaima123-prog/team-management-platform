"""Inbox / deduplication records.

Tracks (event_id, consumer) pairs so at-least-once JetStream delivery
can be deduplicated before a projection is (re)applied - see
repository.py and docs/ARCHITECTURE.md "Python inbox and projections".
"""

from .repository import InboxRepository

__all__ = ["InboxRepository"]

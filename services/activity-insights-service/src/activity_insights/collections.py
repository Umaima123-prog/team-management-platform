"""Collection name constants for insights_db.

Centralized so every module that reads/writes a collection name agrees
on the literal string, instead of repeating it ad hoc.
"""

from __future__ import annotations

INBOX_COLLECTION = "inbox"
ACTIVITY_PROJECTION_COLLECTION = "activity_projection"
WORKLOAD_PROJECTION_COLLECTION = "workload_projection"
PROCESSING_FAILURES_COLLECTION = "processing_failures"

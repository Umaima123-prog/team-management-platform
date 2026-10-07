"""Collection name constants for insights_db.

Centralized so every module that reads/writes a collection name agrees
on the literal string, instead of repeating it ad hoc.
"""

from __future__ import annotations

INBOX_COLLECTION = "inbox"
ACTIVITY_PROJECTION_COLLECTION = "activity_projection"
WORKLOAD_PROJECTION_COLLECTION = "workload_projection"
PROCESSING_FAILURES_COLLECTION = "processing_failures"

# Phase 5 additions. item_state is an internal staging collection (not
# queried externally): one document per work-item aggregate holding its
# last-known column/priority/assignee/archived state, version-gated so
# an older/out-of-order event can never overwrite newer state (see
# projections/state.py). workload_projection's counters are derived
# from *changes* to item_state, not from trusting each event's own
# claimed "previous" value - see docs/ARCHITECTURE.md "Python inbox and
# projections".
ITEM_STATE_COLLECTION = "item_state"

# One document per durable consumer name, tracking the last processed
# JetStream stream sequence and the last successful processing time -
# the assignment's required consumer-state health fields.
CONSUMER_STATE_COLLECTION = "consumer_state"

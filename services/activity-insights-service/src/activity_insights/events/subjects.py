"""Subject/event-type catalogue - mirrors
services/management-service/src/messaging/events/subjects.ts exactly
(see docs/EVENT_CATALOG.md). This is the only place this service
declares which event types it knows about; an eventType outside this
set is treated as non-retryable/unsupported (see messaging/errors.py).
"""

from __future__ import annotations

SUBJECT_PREFIX = "tm.v1."

EVENT_TYPES: frozenset[str] = frozenset(
    {
        "team.created",
        "team.member_added",
        "project.created",
        "project.team_assigned",
        "board.created",
        "workitem.created",
        "workitem.assigned",
        "workitem.moved",
        "workitem.updated",
        "workitem.archived",
    }
)

# Event types that carry work-item workload state (column/priority/
# assignee) - the only ones that mutate item_state/workload_projection.
# Every other known event type is activity-log-only.
WORKITEM_EVENT_TYPES: frozenset[str] = frozenset(
    {
        "workitem.created",
        "workitem.assigned",
        "workitem.moved",
        "workitem.updated",
        "workitem.archived",
    }
)

TEAM_EVENTS_STREAM_NAME = "TEAM_EVENTS"

# Assignment-mandated durable consumer name - must match
# ACTIVITY_INSIGHTS_DURABLE_CONSUMER in the Management Service's
# subjects.ts exactly, since Phase 4 already provisioned a durable
# consumer under this name on the real server and this service only
# ever binds to it (never creates/alters it - see
# messaging/consumer.py).
ACTIVITY_INSIGHTS_DURABLE_CONSUMER = "activity-insights-v1"

PROJECT_INSIGHTS_QUERY_SUBJECT = "tm.query.v1.project_insights"


def subject_for_event_type(event_type: str) -> str:
    return f"{SUBJECT_PREFIX}{event_type}"


def is_known_event_type(value: str) -> bool:
    return value in EVENT_TYPES

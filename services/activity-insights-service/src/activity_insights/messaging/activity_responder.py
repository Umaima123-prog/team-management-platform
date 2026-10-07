"""ActivityResponder: Core NATS request/reply responder for
`tm.query.v1.project_activity` (Phase 6 admin UI's Activity screen).

Mirrors responder.py's InsightsResponder exactly - same subject-naming
convention, same "always reply with a typed status, never silence"
rule, same bounded/no-persistence shape (docs/ARCHITECTURE.md "Core
NATS request/reply"). Reads the real `activity_projection` collection
(projections/activity.py) - the same one the consumer writes to -
never a different or synthesized data source.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

from nats.aio.client import Client as NatsClient
from nats.aio.msg import Msg
from nats.aio.subscription import Subscription

from ..consumer_state import ConsumerStateRepository
from ..events.subjects import PROJECT_ACTIVITY_QUERY_SUBJECT
from ..projections.activity import ActivityProjectionRepository
from ..projections.state import ItemStateRepository

logger = logging.getLogger(__name__)

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


class ActivityResponder:
    def __init__(
        self,
        nc: NatsClient,
        activity: ActivityProjectionRepository,
        consumer_state: ConsumerStateRepository,
        item_state: ItemStateRepository,
        *,
        consumer_name: str,
    ) -> None:
        self._nc = nc
        self._activity = activity
        self._consumer_state = consumer_state
        self._item_state = item_state
        self._consumer_name = consumer_name
        self._subscription: Subscription | None = None

    async def start(self) -> None:
        self._subscription = await self._nc.subscribe(
            PROJECT_ACTIVITY_QUERY_SUBJECT, cb=self._handle
        )
        logger.info("Subscribed to %s for activity queries.", PROJECT_ACTIVITY_QUERY_SUBJECT)

    async def stop(self) -> None:
        if self._subscription is not None:
            await self._subscription.unsubscribe()
            self._subscription = None

    async def _handle(self, msg: Msg) -> None:
        try:
            await self._respond(msg)
        except Exception:  # noqa: BLE001 - a responder must never crash the subscription loop
            logger.exception("Unhandled error answering an activity query - replying not_ready.")
            await self._safe_reply(msg, {"status": "not_ready", "reason": "INTERNAL_ERROR"})

    async def _respond(self, msg: Msg) -> None:
        try:
            request = json.loads(msg.data.decode("utf-8"))
            project_id = request["projectId"]
            if not isinstance(project_id, str) or not project_id:
                raise ValueError("projectId must be a non-empty string")
        except Exception:
            await self._safe_reply(msg, {"status": "not_ready", "reason": "MALFORMED_REQUEST"})
            return

        workspace_id = request.get("workspaceId")
        limit = request.get("limit", DEFAULT_LIMIT)
        if not isinstance(limit, int) or limit <= 0:
            limit = DEFAULT_LIMIT
        limit = min(limit, MAX_LIMIT)

        has_activity = await self._activity.has_any(project_id)
        if not has_activity:
            await self._safe_reply(
                msg, {"status": "not_ready", "reason": "NO_DATA_YET_FOR_PROJECT"}
            )
            return

        known_workspace_id = await self._activity.workspace_for_project(project_id)
        if (
            workspace_id
            and known_workspace_id
            and isinstance(workspace_id, str)
            and workspace_id != known_workspace_id
        ):
            await self._safe_reply(msg, {"status": "not_ready", "reason": "WORKSPACE_MISMATCH"})
            return

        entries = await self._activity.recent_for_project(project_id, limit)
        state = await self._consumer_state.get(self._consumer_name)

        # Human-readable labeling (Phase 6 manual verification found
        # raw WorkItem ids being shown, e.g. "moved WorkItem 6ac5...").
        # issueKey is the only per-item identifier any event ever
        # names (docs/EVENT_CATALOG.md) - captured once, from
        # workitem.created's own payload, into item_state
        # (projections/state.py) - and resolved here via a bulk
        # lookup against that same real projection. Never a
        # management_db read, and never a fabricated title (this
        # project's events deliberately never carry free-text field
        # content - see docs/ARCHITECTURE.md "Events are facts").
        work_item_ids = [
            entry["aggregateId"] for entry in entries if entry["aggregateType"] == "WorkItem"
        ]
        issue_keys = await self._item_state.get_issue_keys(work_item_ids)

        data = {
            "projectId": project_id,
            "generatedAt": datetime.now(UTC).isoformat(),
            "entries": [
                {
                    "eventId": entry["_id"],
                    "eventType": entry["eventType"],
                    "aggregateType": entry["aggregateType"],
                    "aggregateId": entry["aggregateId"],
                    "issueKey": issue_keys.get(entry["aggregateId"]),
                    "actorId": entry["actorId"],
                    "occurredAt": entry["occurredAt"].isoformat()
                    if hasattr(entry["occurredAt"], "isoformat")
                    else entry["occurredAt"],
                }
                for entry in entries
            ],
            "lastProcessedSequence": state["lastProcessedStreamSeq"] if state else None,
        }
        await self._safe_reply(msg, {"status": "ok", "data": data})

    async def _safe_reply(self, msg: Msg, payload: dict) -> None:
        try:
            await msg.respond(json.dumps(payload).encode("utf-8"))
        except Exception:  # noqa: BLE001 - e.g. no reply subject / connection drop mid-request
            logger.warning("Failed to send activity reply (request may have had no reply subject).")

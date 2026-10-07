"""InsightsResponder: Core NATS request/reply responder for
`tm.query.v1.project_insights` (docs/ARCHITECTURE.md "Core NATS
request/reply").

Not JetStream - no persistence of the request/response, a plain
subscribe/respond. Always replies with a well-formed JSON body
matching ProjectInsightsResponse (insights.types.ts on the NestJS
side): `{"status": "ok", "data": {...}}` or `{"status": "not_ready",
"reason": "..."}`. Never lets an internal error propagate as "no
reply" - the NestJS caller's own bounded timeout already covers a
genuinely absent/slow responder; a responder that *is* up should
always answer, even if the answer is "not ready yet".
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

from nats.aio.client import Client as NatsClient
from nats.aio.msg import Msg
from nats.aio.subscription import Subscription

from ..consumer_state import ConsumerStateRepository
from ..events.subjects import PROJECT_INSIGHTS_QUERY_SUBJECT
from ..projections.activity import ActivityProjectionRepository
from ..projections.workload import WorkloadProjectionRepository

logger = logging.getLogger(__name__)


class InsightsResponder:
    def __init__(
        self,
        nc: NatsClient,
        workload: WorkloadProjectionRepository,
        activity: ActivityProjectionRepository,
        consumer_state: ConsumerStateRepository,
        *,
        consumer_name: str,
    ) -> None:
        self._nc = nc
        self._workload = workload
        self._activity = activity
        self._consumer_state = consumer_state
        self._consumer_name = consumer_name
        self._subscription: Subscription | None = None

    async def start(self) -> None:
        self._subscription = await self._nc.subscribe(
            PROJECT_INSIGHTS_QUERY_SUBJECT, cb=self._handle
        )
        logger.info("Subscribed to %s for insights queries.", PROJECT_INSIGHTS_QUERY_SUBJECT)

    async def stop(self) -> None:
        if self._subscription is not None:
            await self._subscription.unsubscribe()
            self._subscription = None

    async def _handle(self, msg: Msg) -> None:
        try:
            await self._respond(msg)
        except Exception:  # noqa: BLE001 - a responder must never crash the subscription loop
            logger.exception("Unhandled error answering an insights query - replying not_ready.")
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

        by_column = await self._workload.counts_for_dimension(project_id, "columnId")
        by_assignee = await self._workload.counts_for_dimension(project_id, "assigneeId")
        by_priority = await self._workload.counts_for_dimension(project_id, "priority")
        state = await self._consumer_state.get(self._consumer_name)

        data = {
            "projectId": project_id,
            "generatedAt": datetime.now(UTC).isoformat(),
            "workloadByAssignee": [
                {"assigneeId": row["key"], "count": row["count"]} for row in by_assignee
            ],
            "countsByStatus": [
                {"columnId": row["key"], "count": row["count"]} for row in by_column
            ],
            # Additive beyond the NestJS-side type (extra fields are
            # ignored by callers that don't know about them) - the
            # assignment also names "priority" as a required workload
            # grouping dimension.
            "workloadByPriority": [
                {"priority": row["key"], "count": row["count"]} for row in by_priority
            ],
            "lastProcessedSequence": state["lastProcessedStreamSeq"] if state else None,
        }
        await self._safe_reply(msg, {"status": "ok", "data": data})

    async def _safe_reply(self, msg: Msg, payload: dict) -> None:
        try:
            await msg.respond(json.dumps(payload).encode("utf-8"))
        except Exception:  # noqa: BLE001 - e.g. no reply subject / connection drop mid-request
            logger.warning("Failed to send insights reply (request may have had no reply subject).")

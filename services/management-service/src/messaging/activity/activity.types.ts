/**
 * Strict request/response contract for the Core NATS request/reply
 * project-activity query (tm.query.v1.project_activity) - the Phase 6
 * admin UI's Activity screen. Mirrors insights.types.ts exactly; see
 * that file's docstring for why this shape (typed fallback states,
 * never a raw 500) rather than a different one.
 */
export interface ProjectActivityEntry {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  /** The work item's issueKey, when `aggregateType` is `'WorkItem'`
   * and its `workitem.created` event has been processed - resolved by
   * the Python responder from its own `item_state` projection, never
   * from management_db. Null for non-WorkItem aggregates, or when
   * that lookup hasn't happened yet (see docs/DECISIONS.md #29). */
  issueKey?: string | null;
  actorId: string;
  occurredAt: string;
}

export interface ProjectActivityData {
  projectId: string;
  generatedAt: string;
  entries: ProjectActivityEntry[];
  lastProcessedSequence: number | null;
}

export type ProjectActivityResponse =
  | { status: 'ok'; data: ProjectActivityData }
  | { status: 'not_ready'; reason: string };

export type ActivityQueryOutcome =
  | { status: 'ok'; data: ProjectActivityData }
  | { status: 'not_ready'; reason: string }
  | { status: 'pending'; reason: 'TIMEOUT' }
  | { status: 'unavailable'; reason: 'NO_RESPONDER' | 'NATS_NOT_CONNECTED' | 'MALFORMED_RESPONSE' | 'ERROR' };

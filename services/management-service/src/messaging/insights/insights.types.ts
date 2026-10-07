/**
 * Strict request/response contract for the Core NATS request/reply
 * project-insights query (assignment subject
 * tm.query.v1.project_insights). The actual Python responder is Phase
 * 5 - this type is what this service's BFF endpoint expects back, and
 * what the Phase 4 stub responder used in integration tests returns.
 */
export interface ProjectInsightsRequest {
  projectId: string;
  workspaceId: string;
  correlationId: string;
}

export interface ProjectInsightsData {
  projectId: string;
  generatedAt: string;
  workloadByAssignee: Array<{ assigneeId: string | null; count: number }>;
  countsByStatus: Array<{ columnId: string; count: number }>;
  lastProcessedSequence: number | null;
}

export type ProjectInsightsResponse =
  | { status: 'ok'; data: ProjectInsightsData }
  | { status: 'not_ready'; reason: string };

/** What the BFF endpoint (GET /api/projects/:projectId/insights)
 * always returns, including the cases the Python responder can never
 * itself produce (timeout, no responder, malformed reply) - see
 * docs/ARCHITECTURE.md "Core NATS request/reply" and TM-12. */
export type InsightsQueryOutcome =
  | { status: 'ok'; data: ProjectInsightsData }
  | { status: 'not_ready'; reason: string }
  | { status: 'pending'; reason: 'TIMEOUT' }
  | { status: 'unavailable'; reason: 'NO_RESPONDER' | 'NATS_NOT_CONNECTED' | 'MALFORMED_RESPONSE' | 'ERROR' };

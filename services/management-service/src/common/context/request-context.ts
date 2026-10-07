/**
 * The trusted, server-resolved identity of the caller for this
 * request. Never constructed from a client-supplied workspaceId -
 * see RequestContextGuard for how it's derived, and
 * docs/ARCHITECTURE.md ("Request context / trust model") for why.
 */
export interface RequestContext {
  userId: string;
  workspaceId: string;
  /** Set by CorrelationIdMiddleware before this guard runs - propagated
   * into outbox rows and NATS headers (see
   * docs/ARCHITECTURE.md "Correlation / observability"). */
  correlationId: string;
}

import { UserRole } from '../../identity/user.schema';

/**
 * The trusted, server-resolved identity of the caller for this
 * request. Never constructed from a client-supplied workspaceId (or,
 * since Phase 9, a client-supplied userId/role either) - see
 * RequestContextGuard for how it's derived, and docs/ARCHITECTURE.md
 * ("Request context / trust model") for why. `userId`/`workspaceId`/
 * `role` all come from a verified JWT's claims (re-checked against the
 * live user record on every request, not just trusted at face value -
 * see RequestContextGuard), never from a header, body, or query param
 * the caller controls.
 */
export interface RequestContext {
  userId: string;
  workspaceId: string;
  role: UserRole;
  /** Set by CorrelationIdMiddleware before this guard runs - propagated
   * into outbox rows and NATS headers (see
   * docs/ARCHITECTURE.md "Correlation / observability"). */
  correlationId: string;
}

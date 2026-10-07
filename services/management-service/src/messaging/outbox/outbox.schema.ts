import { WorkspaceScoped } from '../../database/workspace-scoped.repository';
import { EventEnvelope } from '../events/envelope';
import { EventType } from '../events/subjects';

/**
 * The transactional outbox (docs/ARCHITECTURE.md "Transactional
 * outbox", docs/DECISIONS.md #3). A row here and its authoritative
 * domain mutation are written in the SAME MongoDB transaction (see
 * DatabaseService.withTransaction) - never published directly from a
 * request handler.
 *
 * Minimum fields are the assignment's OutboxEvent model (eventId,
 * subject, schemaVersion, aggregateId, payload, occurredAt,
 * publishedAt, attempts) plus the extra fields this project's
 * architecture names explicitly (aggregateType, aggregateVersion,
 * workspaceId, correlationId, causationId, actorId). `envelope` stores
 * the exact immutable fact that gets published - the relay publishes
 * `envelope` verbatim rather than reconstructing it, so there is no
 * risk of the published payload drifting from what was validated and
 * committed at write time.
 *
 * Operational-only fields (not part of the business fact, used solely
 * by the relay for safe concurrent claiming and bounded retry):
 * claimedAt/leaseUntil, nextAttemptAt, lastErrorCode, failedAt.
 */
export interface OutboxEventDocument extends WorkspaceScoped {
  eventId: string;
  eventType: EventType;
  subject: string;
  schemaVersion: number;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: Record<string, unknown>;
  envelope: EventEnvelope;
  occurredAt: Date;
  correlationId: string;
  causationId: string | null;
  actorId: string;

  /** Set only after a successful JetStream publish acknowledgement
   * (see outbox-relay.service.ts) - null means "not yet published". */
  publishedAt: Date | null;
  attempts: number;

  /** Relay-side claim lease - prevents two concurrent relay ticks (or
   * replicas) from publishing the same row twice in parallel. A stale
   * lease (leaseUntil in the past) is reclaimable. */
  claimedAt: Date | null;
  leaseUntil: Date | null;

  /** When the row becomes eligible for another publish attempt after a
   * retryable failure (bounded exponential backoff). */
  nextAttemptAt: Date | null;

  /** Last classified failure code (never a raw driver/NATS error
   * message or any secret - see retry-policy.ts PublishErrorCode). */
  lastErrorCode: string | null;

  /** Set once a row exhausts its retry budget or hits a non-retryable
   * error - the documented terminal-failure / operator-visible path
   * (see docs/ARCHITECTURE.md "Failure / poison policy"). A failed row
   * is never retried again automatically. */
  failedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

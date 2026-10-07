import { ErrorCode as NatsErrorCode, NatsError } from 'nats';
import { EnvelopeValidationError } from '../events/envelope-validator';

/** Safe, non-secret failure classification stored in
 * OutboxEventDocument.lastErrorCode - never a raw driver/NATS error
 * message (which could, in principle, echo connection details). */
export enum PublishErrorCode {
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  NATS_UNAVAILABLE = 'NATS_UNAVAILABLE',
  NATS_TIMEOUT = 'NATS_TIMEOUT',
  JETSTREAM_NOT_READY = 'JETSTREAM_NOT_READY',
  UNKNOWN = 'UNKNOWN',
}

export interface PublishFailureClassification {
  retryable: boolean;
  code: PublishErrorCode;
}

const RETRYABLE_NATS_CODES = new Set<string>([
  NatsErrorCode.ConnectionClosed,
  NatsErrorCode.ConnectionDraining,
  NatsErrorCode.ConnectionRefused,
  NatsErrorCode.ConnectionTimeout,
  NatsErrorCode.Timeout,
  NatsErrorCode.Disconnect,
  NatsErrorCode.JetStreamNotEnabled, // also used for "503 no responders" style unavailability
]);

/**
 * Classifies a publish failure as retryable (transient
 * NATS/network/availability) or non-retryable (malformed event,
 * unsupported schema, configuration error) - see assignment
 * "Message-handling rules" and docs/ARCHITECTURE.md "Failure / poison
 * policy". Non-retryable failures are never retried, no matter how
 * many attempts remain - retrying a structurally broken event can
 * never succeed.
 */
export function classifyPublishError(error: unknown): PublishFailureClassification {
  if (error instanceof EnvelopeValidationError) {
    return { retryable: false, code: PublishErrorCode.VALIDATION_FAILED };
  }
  if (error instanceof NatsError) {
    if (error.code === (NatsErrorCode.Timeout as string)) {
      return { retryable: true, code: PublishErrorCode.NATS_TIMEOUT };
    }
    if (RETRYABLE_NATS_CODES.has(error.code)) {
      return { retryable: true, code: PublishErrorCode.NATS_UNAVAILABLE };
    }
    // Any other NATS protocol/permission/API error is treated as a
    // configuration problem, not a transient one - retrying it
    // without a human fixing the underlying cause would loop forever.
    return { retryable: false, code: PublishErrorCode.UNKNOWN };
  }
  // Connection not established yet / getJetStreamClient() rejected -
  // treated as transient (NATS may simply not be up yet).
  return { retryable: true, code: PublishErrorCode.JETSTREAM_NOT_READY };
}

export const MAX_PUBLISH_ATTEMPTS = 8;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;

/** Bounded exponential backoff, deterministic (no jitter) for
 * testability. `attempts` is the number of attempts made so far
 * (including the one that just failed), 1-indexed. */
export function computeBackoffMs(attempts: number): number {
  const delay = BASE_DELAY_MS * 2 ** (attempts - 1);
  return Math.min(delay, MAX_DELAY_MS);
}

import { CURRENT_SCHEMA_VERSION, EventEnvelope } from './envelope';
import { isKnownEventType, subjectForEventType } from './subjects';

/**
 * Thrown by validateEnvelope for any structurally invalid envelope -
 * including an unsupported schemaVersion, which "must not be silently
 * accepted" per the assignment's message-handling rules. Always
 * treated as a non-retryable/terminal failure by the relay (see
 * src/messaging/relay/retry-policy.ts) - retrying a malformed local
 * event forever can never succeed.
 */
export class EnvelopeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeValidationError';
  }
}

const UUID_LIKE = /^[A-Za-z0-9][A-Za-z0-9_-]{5,}$/;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new EnvelopeValidationError(message);
}

/**
 * Validates envelope shape and semantics BEFORE publication (and again
 * defensively by the relay right before it hits the wire - see
 * docs/ARCHITECTURE.md). Does not validate event-specific payload
 * shape beyond "is a plain object" - each event type's payload
 * contract lives in docs/EVENT_CATALOG.md and is covered by the
 * service-level tests that construct it.
 */
export function validateEnvelope(envelope: EventEnvelope): void {
  assert(typeof envelope === 'object' && envelope !== null, 'Envelope must be an object.');
  assert(typeof envelope.eventId === 'string' && UUID_LIKE.test(envelope.eventId), 'eventId must be a non-empty identifier.');
  assert(typeof envelope.eventType === 'string' && isKnownEventType(envelope.eventType), `Unknown eventType "${envelope.eventType}". See src/messaging/events/subjects.ts for the documented catalogue.`);
  assert(envelope.schemaVersion === CURRENT_SCHEMA_VERSION, `Unsupported schemaVersion ${envelope.schemaVersion}; this producer only emits version ${CURRENT_SCHEMA_VERSION}.`);
  assert(typeof envelope.occurredAt === 'string' && !Number.isNaN(Date.parse(envelope.occurredAt)), 'occurredAt must be a valid ISO-8601 timestamp.');
  assert(envelope.producer === 'management-service', 'producer must be "management-service".');
  assert(typeof envelope.workspaceId === 'string' && envelope.workspaceId.length > 0, 'workspaceId is required.');
  assert(typeof envelope.aggregate === 'object' && envelope.aggregate !== null, 'aggregate is required.');
  assert(typeof envelope.aggregate.type === 'string' && envelope.aggregate.type.length > 0, 'aggregate.type is required.');
  assert(typeof envelope.aggregate.id === 'string' && envelope.aggregate.id.length > 0, 'aggregate.id is required.');
  assert(Number.isInteger(envelope.aggregate.version) && envelope.aggregate.version >= 1, 'aggregate.version must be a positive integer.');
  assert(typeof envelope.correlationId === 'string' && envelope.correlationId.length > 0, 'correlationId is required.');
  assert(envelope.causationId === null || typeof envelope.causationId === 'string', 'causationId must be a string or null.');
  assert(typeof envelope.actorId === 'string' && envelope.actorId.length > 0, 'actorId is required.');
  assert(typeof envelope.payload === 'object' && envelope.payload !== null, 'payload must be an object.');

  const expectedSubject = subjectForEventType(envelope.eventType);
  void expectedSubject; // subject itself is derived/stored alongside the envelope - see outbox.schema.ts
}

/** Convenience used where a (subject, envelope) pair must agree -
 * catches a bug where an outbox row's stored `subject` drifted from
 * its envelope's `eventType`. */
export function assertSubjectMatchesEnvelope(subject: string, envelope: EventEnvelope): void {
  const expected = subjectForEventType(envelope.eventType);
  assert(subject === expected, `subject "${subject}" does not match envelope eventType "${envelope.eventType}" (expected "${expected}").`);
}

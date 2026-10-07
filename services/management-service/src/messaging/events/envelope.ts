import { EventType } from './subjects';

/** Payload schema version this service currently produces. Unknown
 * (higher or lower) versions must be rejected - see
 * envelope-validator.ts. A future breaking payload change bumps this
 * (and, per docs/DECISIONS.md, a new subject version rather than a
 * silent change to v1 consumers already depend on). */
export const CURRENT_SCHEMA_VERSION = 1 as const;

export interface EventAggregateRef {
  type: string;
  id: string;
  /** The aggregate's version AFTER this event's change. */
  version: number;
}

/**
 * The canonical version-1 domain event envelope (assignment PDF,
 * section 8 "Canonical event envelope"). `payload` is the only part
 * that varies per event type - see docs/EVENT_CATALOG.md for the
 * payload shape of each eventType.
 *
 * This is an immutable fact about something that already happened
 * (past tense, never mutated once created) - see
 * docs/ARCHITECTURE.md "Events are facts".
 */
export interface EventEnvelope<TPayload = Record<string, unknown>> {
  eventId: string;
  eventType: EventType;
  schemaVersion: number;
  occurredAt: string;
  producer: 'management-service';
  workspaceId: string;
  aggregate: EventAggregateRef;
  correlationId: string;
  causationId: string | null;
  actorId: string;
  payload: TPayload;
}

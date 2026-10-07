/**
 * The assignment's documented JetStream subject catalogue (see the
 * engineering-onboarding assignment PDF, section 8, and
 * docs/EVENT_CATALOG.md). This is the only place new event types are
 * declared - domain services reference the `EventType` union, never a
 * raw subject string, so an unlisted subject cannot be published by
 * accident (see docs/DECISIONS.md for why no subject is invented here
 * beyond this list).
 *
 * Subject shape: `tm.v1.<eventType>` for durable JetStream domain
 * events. `tm.query.v1.project_insights` is a separate, non-versioned-
 * the-same-way Core NATS request/reply subject (see
 * src/messaging/insights/) and intentionally excluded from this map.
 */
export const EVENT_TYPES = [
  'team.created',
  'team.member_added',
  'project.created',
  'project.team_assigned',
  'board.created',
  'workitem.created',
  'workitem.assigned',
  'workitem.moved',
  'workitem.updated',
  'workitem.archived',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const SUBJECT_PREFIX = 'tm.v1.';

export function subjectForEventType(eventType: EventType): string {
  return `${SUBJECT_PREFIX}${eventType}`;
}

const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

export function isKnownEventType(value: string): value is EventType {
  return EVENT_TYPE_SET.has(value);
}

/** The TEAM_EVENTS JetStream stream captures every event subject. */
export const TEAM_EVENTS_STREAM_NAME = 'TEAM_EVENTS';
export const TEAM_EVENTS_SUBJECT_FILTER = 'tm.v1.>';

/** The durable Python consumer name mandated by the assignment. */
export const ACTIVITY_INSIGHTS_DURABLE_CONSUMER = 'activity-insights-v1';

/** Core NATS (non-JetStream) request/reply subject for synchronous
 * project insight queries - see docs/ARCHITECTURE.md "Core NATS vs
 * JetStream". */
export const PROJECT_INSIGHTS_QUERY_SUBJECT = 'tm.query.v1.project_insights';

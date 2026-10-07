import { EventEnvelope } from './envelope';
import { assertSubjectMatchesEnvelope, EnvelopeValidationError, validateEnvelope } from './envelope-validator';
import { subjectForEventType } from './subjects';

function baseEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: '01J000000000000000000000AA',
    eventType: 'team.created',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    producer: 'management-service',
    workspaceId: 'ws-1',
    aggregate: { type: 'Team', id: 'team-1', version: 1 },
    correlationId: 'corr-1',
    causationId: null,
    actorId: 'user-1',
    payload: { code: 'PAY', name: 'Payments' },
    ...overrides,
  };
}

describe('validateEnvelope', () => {
  it('accepts a well-formed version-1 envelope', () => {
    expect(() => validateEnvelope(baseEnvelope())).not.toThrow();
  });

  it('rejects an unsupported schemaVersion instead of silently accepting it', () => {
    expect(() => validateEnvelope(baseEnvelope({ schemaVersion: 2 }))).toThrow(EnvelopeValidationError);
    expect(() => validateEnvelope(baseEnvelope({ schemaVersion: 0 }))).toThrow(EnvelopeValidationError);
  });

  it('rejects an eventType outside the documented subject catalogue', () => {
    expect(() =>
      validateEnvelope(baseEnvelope({ eventType: 'team.deleted' as never })),
    ).toThrow(EnvelopeValidationError);
  });

  it('rejects a missing/empty eventId', () => {
    expect(() => validateEnvelope(baseEnvelope({ eventId: '' }))).toThrow(EnvelopeValidationError);
  });

  it('rejects a non-ISO occurredAt', () => {
    expect(() => validateEnvelope(baseEnvelope({ occurredAt: 'not-a-date' }))).toThrow(
      EnvelopeValidationError,
    );
  });

  it('rejects a producer other than management-service', () => {
    expect(() =>
      validateEnvelope(baseEnvelope({ producer: 'someone-else' as never })),
    ).toThrow(EnvelopeValidationError);
  });

  it('rejects a missing workspaceId', () => {
    expect(() => validateEnvelope(baseEnvelope({ workspaceId: '' }))).toThrow(EnvelopeValidationError);
  });

  it('rejects an aggregate with a non-positive version', () => {
    expect(() =>
      validateEnvelope(baseEnvelope({ aggregate: { type: 'Team', id: 'team-1', version: 0 } })),
    ).toThrow(EnvelopeValidationError);
  });

  it('rejects a missing correlationId', () => {
    expect(() => validateEnvelope(baseEnvelope({ correlationId: '' }))).toThrow(EnvelopeValidationError);
  });

  it('accepts causationId as null or a string, rejects any other type', () => {
    expect(() => validateEnvelope(baseEnvelope({ causationId: null }))).not.toThrow();
    expect(() => validateEnvelope(baseEnvelope({ causationId: 'evt-root' }))).not.toThrow();
    expect(() => validateEnvelope(baseEnvelope({ causationId: 42 as never }))).toThrow(
      EnvelopeValidationError,
    );
  });

  it('rejects a missing actorId', () => {
    expect(() => validateEnvelope(baseEnvelope({ actorId: '' }))).toThrow(EnvelopeValidationError);
  });

  it('rejects a non-object payload', () => {
    expect(() => validateEnvelope(baseEnvelope({ payload: null as never }))).toThrow(
      EnvelopeValidationError,
    );
  });
});

describe('subjectForEventType / subject mapping', () => {
  it('maps every documented eventType to the tm.v1.<eventType> subject', () => {
    expect(subjectForEventType('team.created')).toBe('tm.v1.team.created');
    expect(subjectForEventType('team.member_added')).toBe('tm.v1.team.member_added');
    expect(subjectForEventType('project.created')).toBe('tm.v1.project.created');
    expect(subjectForEventType('project.team_assigned')).toBe('tm.v1.project.team_assigned');
    expect(subjectForEventType('board.created')).toBe('tm.v1.board.created');
    expect(subjectForEventType('workitem.created')).toBe('tm.v1.workitem.created');
    expect(subjectForEventType('workitem.assigned')).toBe('tm.v1.workitem.assigned');
    expect(subjectForEventType('workitem.moved')).toBe('tm.v1.workitem.moved');
    expect(subjectForEventType('workitem.updated')).toBe('tm.v1.workitem.updated');
    expect(subjectForEventType('workitem.archived')).toBe('tm.v1.workitem.archived');
  });
});

describe('assertSubjectMatchesEnvelope', () => {
  it('passes when the subject matches the envelope eventType', () => {
    expect(() => assertSubjectMatchesEnvelope('tm.v1.team.created', baseEnvelope())).not.toThrow();
  });

  it('throws when a stored subject has drifted from its envelope eventType', () => {
    expect(() => assertSubjectMatchesEnvelope('tm.v1.board.created', baseEnvelope())).toThrow(
      EnvelopeValidationError,
    );
  });
});

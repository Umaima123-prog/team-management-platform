import { ClientSession } from 'mongodb';
import { EnvelopeValidationError } from '../events/envelope-validator';
import { OutboxRepository } from './outbox.repository';
import { OutboxService } from './outbox.service';

describe('OutboxService.enqueue', () => {
  let outboxRepository: { insert: jest.Mock };
  let service: OutboxService;
  const SESSION = {} as ClientSession;

  beforeEach(() => {
    outboxRepository = { insert: jest.fn().mockResolvedValue(undefined) };
    service = new OutboxService(outboxRepository as unknown as OutboxRepository);
  });

  it('builds a valid envelope, persists it via the repository, and returns it', async () => {
    const envelope = await service.enqueue(SESSION, {
      workspaceId: 'ws-1',
      eventType: 'team.created',
      aggregateType: 'Team',
      aggregateId: 'team-1',
      aggregateVersion: 1,
      correlationId: 'corr-1',
      causationId: null,
      actorId: 'user-1',
      payload: { code: 'PAY', name: 'Payments' },
    });

    expect(envelope.eventType).toBe('team.created');
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.workspaceId).toBe('ws-1');
    expect(envelope.aggregate).toEqual({ type: 'Team', id: 'team-1', version: 1 });
    expect(typeof envelope.eventId).toBe('string');
    expect(envelope.eventId.length).toBeGreaterThan(0);

    expect(outboxRepository.insert).toHaveBeenCalledTimes(1);
    const [stored, session] = outboxRepository.insert.mock.calls[0] as [
      { subject: string; eventId: string; envelope: unknown },
      ClientSession,
    ];
    expect(stored.subject).toBe('tm.v1.team.created');
    expect(stored.eventId).toBe(envelope.eventId);
    expect(stored.envelope).toBe(envelope);
    expect(session).toBe(SESSION);
  });

  it('generates a distinct eventId on every call', async () => {
    const first = await service.enqueue(SESSION, {
      workspaceId: 'ws-1',
      eventType: 'team.created',
      aggregateType: 'Team',
      aggregateId: 'team-1',
      aggregateVersion: 1,
      correlationId: 'corr-1',
      causationId: null,
      actorId: 'user-1',
      payload: {},
    });
    const second = await service.enqueue(SESSION, {
      workspaceId: 'ws-1',
      eventType: 'team.created',
      aggregateType: 'Team',
      aggregateId: 'team-1',
      aggregateVersion: 1,
      correlationId: 'corr-1',
      causationId: null,
      actorId: 'user-1',
      payload: {},
    });

    expect(first.eventId).not.toBe(second.eventId);
  });

  it('never persists an invalid envelope (e.g. a workspaceId that failed to be supplied)', async () => {
    await expect(
      service.enqueue(SESSION, {
        workspaceId: '',
        eventType: 'team.created',
        aggregateType: 'Team',
        aggregateId: 'team-1',
        aggregateVersion: 1,
        correlationId: 'corr-1',
        causationId: null,
        actorId: 'user-1',
        payload: {},
      }),
    ).rejects.toThrow(EnvelopeValidationError);
    expect(outboxRepository.insert).not.toHaveBeenCalled();
  });
});

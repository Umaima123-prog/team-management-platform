import { ConfigService } from '@nestjs/config';
import { NatsError, ErrorCode as NatsErrorCode } from 'nats';
import { DatabaseService } from '../../database/database.service';
import { NatsConnectionService } from '../nats/nats-connection.service';
import { OutboxRepository } from '../outbox/outbox.repository';
import { OutboxEventDocument } from '../outbox/outbox.schema';
import { OutboxRelayService } from './outbox-relay.service';
import { MAX_PUBLISH_ATTEMPTS } from './retry-policy';

function makeRecord(overrides: Partial<OutboxEventDocument> = {}): OutboxEventDocument {
  return {
    workspaceId: 'ws-1',
    eventId: 'evt-000001',
    eventType: 'team.created',
    subject: 'tm.v1.team.created',
    schemaVersion: 1,
    aggregateType: 'Team',
    aggregateId: 'team-1',
    aggregateVersion: 1,
    payload: { code: 'PAY', name: 'Payments' },
    envelope: {
      eventId: 'evt-000001',
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
    },
    occurredAt: new Date(),
    correlationId: 'corr-1',
    causationId: null,
    actorId: 'user-1',
    publishedAt: null,
    attempts: 0,
    claimedAt: new Date(),
    leaseUntil: new Date(Date.now() + 30_000),
    nextAttemptAt: null,
    lastErrorCode: null,
    failedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('OutboxRelayService', () => {
  let outboxRepository: {
    claimBatch: jest.Mock;
    markPublished: jest.Mock;
    scheduleRetry: jest.Mock;
    markTerminalFailure: jest.Mock;
  };
  let jetStreamClient: { publish: jest.Mock };
  let nats: { getJetStreamClient: jest.Mock };
  let databaseService: { ensureConnected: jest.Mock };
  let config: { get: jest.Mock };
  let relay: OutboxRelayService;
  let callOrder: string[];

  beforeEach(() => {
    callOrder = [];
    jetStreamClient = {
      publish: jest.fn().mockImplementation(() => {
        callOrder.push('publish');
        return Promise.resolve({ stream: 'TEAM_EVENTS', seq: 1, duplicate: false });
      }),
    };
    outboxRepository = {
      claimBatch: jest.fn().mockResolvedValue([]),
      markPublished: jest.fn().mockImplementation(() => {
        callOrder.push('markPublished');
        return Promise.resolve();
      }),
      scheduleRetry: jest.fn().mockResolvedValue(undefined),
      markTerminalFailure: jest.fn().mockResolvedValue(undefined),
    };
    nats = { getJetStreamClient: jest.fn().mockResolvedValue(jetStreamClient) };
    databaseService = { ensureConnected: jest.fn().mockResolvedValue(undefined) };
    config = { get: jest.fn().mockReturnValue(undefined) };

    relay = new OutboxRelayService(
      outboxRepository as unknown as OutboxRepository,
      nats as unknown as NatsConnectionService,
      databaseService as unknown as DatabaseService,
      config as unknown as ConfigService,
    );
  });

  it('publishes each claimed record and marks it published only AFTER the publish acknowledgement resolves', async () => {
    const record = makeRecord();
    outboxRepository.claimBatch.mockResolvedValue([record]);

    await relay.tick();

    expect(callOrder).toEqual(['publish', 'markPublished']);
    expect(outboxRepository.markPublished).toHaveBeenCalledWith('evt-000001');
  });

  it('sets Nats-Msg-Id (via the msgID publish option) to the eventId', async () => {
    const record = makeRecord();
    outboxRepository.claimBatch.mockResolvedValue([record]);

    await relay.tick();

    const [, , options] = jetStreamClient.publish.mock.calls[0] as [string, Uint8Array, { msgID: string }];
    expect(options.msgID).toBe('evt-000001');
  });

  it('propagates correlationId, causationId, eventId, schemaVersion, and aggregate headers', async () => {
    const record = makeRecord({ causationId: 'evt-root' });
    outboxRepository.claimBatch.mockResolvedValue([record]);

    await relay.tick();

    const [, , options] = jetStreamClient.publish.mock.calls[0] as [
      string,
      Uint8Array,
      { headers: { get: (k: string) => string } },
    ];
    expect(options.headers.get('X-Correlation-Id')).toBe('corr-1');
    expect(options.headers.get('X-Causation-Id')).toBe('evt-root');
    expect(options.headers.get('X-Event-Id')).toBe('evt-000001');
    expect(options.headers.get('X-Schema-Version')).toBe('1');
    expect(options.headers.get('X-Aggregate-Type')).toBe('Team');
    expect(options.headers.get('X-Aggregate-Id')).toBe('team-1');
    expect(options.headers.get('X-Aggregate-Version')).toBe('1');
  });

  it('publishes to the record subject, with canonical JSON bytes of the stored envelope', async () => {
    const record = makeRecord();
    outboxRepository.claimBatch.mockResolvedValue([record]);

    await relay.tick();

    const [subject, data] = jetStreamClient.publish.mock.calls[0] as [string, Uint8Array];
    expect(subject).toBe('tm.v1.team.created');
    expect(JSON.parse(new TextDecoder().decode(data))).toEqual(record.envelope);
  });

  it('never marks a row published when the JetStream publish rejects', async () => {
    const record = makeRecord();
    outboxRepository.claimBatch.mockResolvedValue([record]);
    jetStreamClient.publish.mockRejectedValue(new NatsError('timeout', NatsErrorCode.Timeout));

    await relay.tick();

    expect(outboxRepository.markPublished).not.toHaveBeenCalled();
  });

  it('schedules a backoff retry on a retryable (e.g. timeout) failure, below the attempt ceiling', async () => {
    const record = makeRecord({ attempts: 0 });
    outboxRepository.claimBatch.mockResolvedValue([record]);
    jetStreamClient.publish.mockRejectedValue(new NatsError('timeout', NatsErrorCode.Timeout));

    await relay.tick();

    expect(outboxRepository.scheduleRetry).toHaveBeenCalledWith(
      'evt-000001',
      'NATS_TIMEOUT',
      expect.any(Date),
    );
    expect(outboxRepository.markTerminalFailure).not.toHaveBeenCalled();
  });

  it('marks a row as a terminal failure once the retry budget is exhausted, even for a retryable error', async () => {
    const record = makeRecord({ attempts: MAX_PUBLISH_ATTEMPTS - 1 });
    outboxRepository.claimBatch.mockResolvedValue([record]);
    jetStreamClient.publish.mockRejectedValue(new NatsError('timeout', NatsErrorCode.Timeout));

    await relay.tick();

    expect(outboxRepository.markTerminalFailure).toHaveBeenCalledWith('evt-000001', 'NATS_TIMEOUT');
    expect(outboxRepository.scheduleRetry).not.toHaveBeenCalled();
  });

  it('marks a malformed stored envelope as a terminal failure immediately, never retrying it', async () => {
    const record = makeRecord({
      envelope: { ...makeRecord().envelope, schemaVersion: 99 },
    });
    outboxRepository.claimBatch.mockResolvedValue([record]);

    await relay.tick();

    expect(jetStreamClient.publish).not.toHaveBeenCalled();
    expect(outboxRepository.markTerminalFailure).toHaveBeenCalledWith('evt-000001', 'VALIDATION_FAILED');
    expect(outboxRepository.scheduleRetry).not.toHaveBeenCalled();
  });

  it('does not re-enter tick() while a previous tick is still running (no unsafe concurrent processing)', async () => {
    let resolveClaimBatch!: (value: OutboxEventDocument[]) => void;
    outboxRepository.claimBatch.mockReturnValue(
      new Promise<OutboxEventDocument[]>((resolve) => {
        resolveClaimBatch = resolve;
      }),
    );

    const firstTick = relay.tick();
    const secondTick = relay.tick(); // should return immediately, no-op

    resolveClaimBatch([]);
    await Promise.all([firstTick, secondTick]);

    expect(outboxRepository.claimBatch).toHaveBeenCalledTimes(1);
  });

  // Regression coverage for the real bug reproduced outside the
  // sandbox: the relay kept hitting MongoTopologyClosedError on every
  // tick, forever, because nothing ever asked the shared MongoClient
  // to repair itself after a topology closure. See
  // database.service.spec.ts "ensureConnected" and docs/DECISIONS.md #16.
  describe('Mongo self-heal wiring', () => {
    it('calls databaseService.ensureConnected() before claiming the batch, every tick', async () => {
      await relay.tick();

      expect(databaseService.ensureConnected).toHaveBeenCalledTimes(1);
      const ensureOrder = databaseService.ensureConnected.mock.invocationCallOrder[0];
      const claimOrder = outboxRepository.claimBatch.mock.invocationCallOrder[0];
      expect(ensureOrder).toBeLessThan(claimOrder);
    });

    it('never lets a failed repair attempt crash the relay - tick() resolves, logged not thrown', async () => {
      // ensureConnected() is contractually non-throwing in real usage
      // (it swallows its own errors - see database.service.spec.ts),
      // but tick() must stay safe even if that contract were ever
      // violated: the existing tick()-level try/catch must still catch
      // it rather than letting it escape as an unhandled rejection.
      databaseService.ensureConnected.mockRejectedValue(new Error('reconnect failed'));

      await expect(relay.tick()).resolves.toBeUndefined();
      expect(databaseService.ensureConnected).toHaveBeenCalledTimes(1);
    });

    it('calls ensureConnected() again on every subsequent tick (not just once at startup)', async () => {
      await relay.tick();
      await relay.tick();
      await relay.tick();

      expect(databaseService.ensureConnected).toHaveBeenCalledTimes(3);
    });
  });
});

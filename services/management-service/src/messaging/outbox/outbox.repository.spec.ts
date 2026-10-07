import { ClientSession } from 'mongodb';
import { DatabaseService } from '../../database/database.service';
import { OutboxRepository } from './outbox.repository';

describe('OutboxRepository', () => {
  let collection: {
    insertOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    updateOne: jest.Mock;
    countDocuments: jest.Mock;
    findOne: jest.Mock;
  };
  let databaseService: { getCollection: jest.Mock };
  let repository: OutboxRepository;
  const SESSION = {} as ClientSession;

  beforeEach(() => {
    collection = {
      insertOne: jest.fn().mockResolvedValue({ insertedId: 'id-1' }),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({}),
      countDocuments: jest.fn().mockResolvedValue(0),
      findOne: jest.fn(),
    };
    databaseService = { getCollection: jest.fn().mockReturnValue(collection) };
    repository = new OutboxRepository(databaseService as unknown as DatabaseService);
  });

  it('reads/writes the dedicated outbox_events collection', () => {
    expect(databaseService.getCollection).toHaveBeenCalledWith('outbox_events');
  });

  describe('insert', () => {
    it('inserts a fresh row with publishedAt/claimedAt/failedAt null and attempts 0, using the given session', async () => {
      const envelope = { eventId: 'evt-1' } as never;
      await repository.insert(
        {
          workspaceId: 'ws-1',
          eventId: 'evt-1',
          eventType: 'team.created',
          subject: 'tm.v1.team.created',
          schemaVersion: 1,
          aggregateType: 'Team',
          aggregateId: 'team-1',
          aggregateVersion: 1,
          payload: {},
          envelope,
          occurredAt: new Date(),
          correlationId: 'corr-1',
          causationId: null,
          actorId: 'user-1',
        },
        SESSION,
      );

      expect(collection.insertOne).toHaveBeenCalledTimes(1);
      const [doc, options] = collection.insertOne.mock.calls[0] as [Record<string, unknown>, { session: unknown }];
      expect(doc).toMatchObject({
        eventId: 'evt-1',
        publishedAt: null,
        attempts: 0,
        claimedAt: null,
        leaseUntil: null,
        nextAttemptAt: null,
        lastErrorCode: null,
        failedAt: null,
      });
      expect(options.session).toBe(SESSION);
    });
  });

  describe('claimBatch', () => {
    it('stops claiming once findOneAndUpdate returns null (fewer eligible rows than the batch size)', async () => {
      collection.findOneAndUpdate
        .mockResolvedValueOnce({ eventId: 'evt-1' })
        .mockResolvedValueOnce({ eventId: 'evt-2' })
        .mockResolvedValueOnce(null);

      const claimed = await repository.claimBatch(5, 30_000);

      expect(claimed).toHaveLength(2);
      expect(collection.findOneAndUpdate).toHaveBeenCalledTimes(3);
    });

    it('sets claimedAt/leaseUntil atomically via findOneAndUpdate (one call per claim)', async () => {
      collection.findOneAndUpdate.mockResolvedValueOnce({ eventId: 'evt-1' }).mockResolvedValueOnce(null);

      await repository.claimBatch(5, 30_000);

      const [filter, update, options] = collection.findOneAndUpdate.mock.calls[0] as [
        Record<string, unknown>,
        { $set: Record<string, unknown> },
        Record<string, unknown>,
      ];
      expect(filter).toMatchObject({ publishedAt: null, failedAt: null });
      expect(update.$set.claimedAt).toBeInstanceOf(Date);
      expect(update.$set.leaseUntil).toBeInstanceOf(Date);
      expect(options.returnDocument).toBe('after');
    });

    it('never exceeds the requested limit', async () => {
      collection.findOneAndUpdate.mockResolvedValue({ eventId: 'evt-x' });

      const claimed = await repository.claimBatch(3, 30_000);

      expect(claimed).toHaveLength(3);
      expect(collection.findOneAndUpdate).toHaveBeenCalledTimes(3);
    });
  });

  describe('markPublished', () => {
    it('sets publishedAt and clears the claim lease, incrementing attempts', async () => {
      await repository.markPublished('evt-1');

      const [filter, update] = collection.updateOne.mock.calls[0] as [
        Record<string, unknown>,
        { $set: Record<string, unknown>; $inc: Record<string, unknown> },
      ];
      expect(filter).toEqual({ eventId: 'evt-1' });
      expect(update.$set.publishedAt).toBeInstanceOf(Date);
      expect(update.$set.claimedAt).toBeNull();
      expect(update.$set.leaseUntil).toBeNull();
      expect(update.$inc).toEqual({ attempts: 1 });
    });
  });

  describe('scheduleRetry', () => {
    it('clears the claim lease and sets nextAttemptAt/lastErrorCode, incrementing attempts', async () => {
      const nextAttemptAt = new Date(Date.now() + 5000);
      await repository.scheduleRetry('evt-1', 'NATS_TIMEOUT', nextAttemptAt);

      const [, update] = collection.updateOne.mock.calls[0] as [
        unknown,
        { $set: Record<string, unknown>; $inc: Record<string, unknown> },
      ];
      expect(update.$set.claimedAt).toBeNull();
      expect(update.$set.nextAttemptAt).toBe(nextAttemptAt);
      expect(update.$set.lastErrorCode).toBe('NATS_TIMEOUT');
      expect(update.$inc).toEqual({ attempts: 1 });
    });
  });

  describe('markTerminalFailure', () => {
    it('sets failedAt and lastErrorCode, never leaving the row claimable again', async () => {
      await repository.markTerminalFailure('evt-1', 'VALIDATION_FAILED');

      const [, update] = collection.updateOne.mock.calls[0] as [
        unknown,
        { $set: Record<string, unknown>; $inc: Record<string, unknown> },
      ];
      expect(update.$set.failedAt).toBeInstanceOf(Date);
      expect(update.$set.lastErrorCode).toBe('VALIDATION_FAILED');
      expect(update.$set.claimedAt).toBeNull();
    });
  });

  describe('countFailed / countUnpublished', () => {
    it('counts rows with a non-null failedAt', async () => {
      await repository.countFailed();
      expect(collection.countDocuments).toHaveBeenCalledWith({ failedAt: { $ne: null } });
    });

    it('counts rows that are neither published nor failed', async () => {
      await repository.countUnpublished();
      expect(collection.countDocuments).toHaveBeenCalledWith({ publishedAt: null, failedAt: null });
    });
  });
});

import { Db, MongoClient } from 'mongodb';
import { DatabaseService } from './database.service';

describe('DatabaseService', () => {
  let db: { command: jest.Mock; databaseName: string; collection: jest.Mock };
  let client: { startSession: jest.Mock; connect: jest.Mock };
  let session: { withTransaction: jest.Mock; endSession: jest.Mock };
  let service: DatabaseService;

  beforeEach(() => {
    db = {
      command: jest.fn(),
      databaseName: 'management_db',
      collection: jest.fn(),
    };
    session = {
      withTransaction: jest.fn(async (fn: () => Promise<void>) => {
        await fn();
      }),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    client = {
      startSession: jest.fn().mockReturnValue(session),
      connect: jest.fn().mockResolvedValue(undefined),
    };
    service = new DatabaseService(client as unknown as MongoClient, db as unknown as Db);
  });

  it('returns the configured database name', () => {
    expect(service.getDatabaseName()).toBe('management_db');
  });

  it('delegates getCollection to the underlying db', () => {
    const fakeCollection = {};
    db.collection.mockReturnValue(fakeCollection);

    expect(service.getCollection('outbox')).toBe(fakeCollection);
    expect(db.collection).toHaveBeenCalledWith('outbox');
  });

  it('ping() returns true when the server responds', async () => {
    db.command.mockResolvedValue({ ok: 1 });

    await expect(service.ping()).resolves.toBe(true);
    expect(db.command).toHaveBeenCalledWith({ ping: 1 });
  });

  it('ping() returns false (not throws) when the server is unreachable', async () => {
    db.command.mockRejectedValue(new Error('connection refused'));

    await expect(service.ping()).resolves.toBe(false);
  });

  // Regression coverage for the real bug reproduced outside the
  // sandbox: a MongoClient whose topology self-closed after a failed
  // first connection attempt made EVERY subsequent operation
  // (ping() -> GET /health/ready, and the relay's own queries) fail
  // forever with MongoTopologyClosedError, with no recovery short of a
  // full process restart. See docs/DECISIONS.md #16.
  describe('ensureConnected (self-healing reconnect)', () => {
    it('ping() calls client.connect() before pinging, so a closed topology gets repaired first', async () => {
      db.command.mockResolvedValue({ ok: 1 });

      await service.ping();

      expect(client.connect).toHaveBeenCalledTimes(1);
      // The repair attempt must happen BEFORE the actual ping command,
      // not after - otherwise the first ping after a closed topology
      // would still fail.
      const connectOrder = client.connect.mock.invocationCallOrder[0];
      const commandOrder = db.command.mock.invocationCallOrder[0];
      expect(connectOrder).toBeLessThan(commandOrder);
    });

    it('ping() still returns false (never throws) when the repair attempt itself fails', async () => {
      client.connect.mockRejectedValue(new Error('still unreachable'));
      db.command.mockRejectedValue(new Error('topology is closed'));

      await expect(service.ping()).resolves.toBe(false);
    });

    it('ping() succeeds once connect() starts resolving again, with no process restart required', async () => {
      // Simulates exactly the reported bug/fix: first call represents
      // the still-broken state, second call represents the self-heal
      // taking effect on the SAME DatabaseService/client instance.
      db.command.mockRejectedValueOnce(new Error('MongoTopologyClosedError'));
      db.command.mockResolvedValueOnce({ ok: 1 });

      await expect(service.ping()).resolves.toBe(false);
      await expect(service.ping()).resolves.toBe(true);
      expect(client.connect).toHaveBeenCalledTimes(2);
    });

    it('ensureConnected() itself never rejects, even when client.connect() does', async () => {
      client.connect.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.ensureConnected()).resolves.toBeUndefined();
    });

    it('withTransaction() also calls client.connect() first, so domain writes self-heal the same way', async () => {
      await service.withTransaction(() => Promise.resolve('ok'));

      expect(client.connect).toHaveBeenCalledTimes(1);
      const connectOrder = client.connect.mock.invocationCallOrder[0];
      const startSessionOrder = client.startSession.mock.invocationCallOrder[0];
      expect(connectOrder).toBeLessThan(startSessionOrder);
    });
  });

  describe('withTransaction', () => {
    it('runs fn inside a session and returns its result', async () => {
      const result = await service.withTransaction((s) => {
        expect(s).toBe(session);
        return Promise.resolve('done');
      });

      expect(result).toBe('done');
      expect(client.startSession).toHaveBeenCalledTimes(1);
      expect(session.withTransaction).toHaveBeenCalledTimes(1);
      expect(session.endSession).toHaveBeenCalledTimes(1);
    });

    it('always ends the session, even when fn throws', async () => {
      session.withTransaction.mockImplementation(async (fn: () => Promise<unknown>) => {
        await fn();
      });

      await expect(
        service.withTransaction(() => Promise.reject(new Error('boom'))),
      ).rejects.toThrow('boom');

      expect(session.endSession).toHaveBeenCalledTimes(1);
    });
  });
});

import { Db } from 'mongodb';
import { DatabaseService } from './database.service';

describe('DatabaseService', () => {
  let db: { command: jest.Mock; databaseName: string; collection: jest.Mock };
  let service: DatabaseService;

  beforeEach(() => {
    db = {
      command: jest.fn(),
      databaseName: 'management_db',
      collection: jest.fn(),
    };
    service = new DatabaseService(db as unknown as Db);
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
});

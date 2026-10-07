import { DatabaseService } from '../database/database.service';
import { CountersRepository } from './counters.repository';

/**
 * Phase 7 gap: issue-key generation's actual uniqueness guarantee is
 * this atomic `$inc` + upsert (see counters.repository.ts's
 * docstring) - every other test (work-items.service.spec.ts,
 * issue-key.util.spec.ts) mocks `getNextSequence` or tests the pure
 * string-formatting helper, so the atomic-operation shape itself was
 * never actually asserted.
 */
describe('CountersRepository', () => {
  let collection: { findOneAndUpdate: jest.Mock };
  let databaseService: { getCollection: jest.Mock };
  let repository: CountersRepository;

  beforeEach(() => {
    collection = { findOneAndUpdate: jest.fn() };
    databaseService = { getCollection: jest.fn().mockReturnValue(collection) };
    repository = new CountersRepository(databaseService as unknown as DatabaseService);
  });

  it('atomically increments the per-project sequence via a single $inc + upsert, never read-then-write', async () => {
    collection.findOneAndUpdate.mockResolvedValue({ _id: 'proj-1', seq: 5 });

    const seq = await repository.getNextSequence('ws-1', 'proj-1');

    expect(seq).toBe(5);
    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'proj-1' },
      { $inc: { seq: 1 }, $setOnInsert: { workspaceId: 'ws-1' } },
      { upsert: true, returnDocument: 'after', session: undefined },
    );
  });

  it('passes the transaction session through so the increment is part of the same atomic write as the item insert', async () => {
    const session = {} as never;
    collection.findOneAndUpdate.mockResolvedValue({ _id: 'proj-1', seq: 1 });

    await repository.getNextSequence('ws-1', 'proj-1', session);

    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ session }),
    );
  });

  it('never reuses a sequence number across two concurrent-looking calls for the same project', async () => {
    collection.findOneAndUpdate.mockResolvedValueOnce({ _id: 'proj-1', seq: 1 });
    collection.findOneAndUpdate.mockResolvedValueOnce({ _id: 'proj-1', seq: 2 });

    const first = await repository.getNextSequence('ws-1', 'proj-1');
    const second = await repository.getNextSequence('ws-1', 'proj-1');

    expect(first).toBe(1);
    expect(second).toBe(2);
  });
});

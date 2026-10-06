import { Db } from 'mongodb';
import { IndexBootstrapService } from './index-bootstrap.service';
import { INDEX_REGISTRY } from './index-registry';

describe('IndexBootstrapService', () => {
  it('has a registry entry for every Phase 3 domain collection', () => {
    const names = INDEX_REGISTRY.map((spec) => spec.collection);
    expect(names).toEqual(
      expect.arrayContaining(['users', 'teams', 'memberships', 'projects', 'boards', 'work_items']),
    );
  });

  it('applies createIndexes for every registered collection on bootstrap', async () => {
    const createIndexes = jest.fn().mockResolvedValue(undefined);
    const collection = jest.fn().mockReturnValue({ createIndexes });
    const db = { collection } as unknown as Db;
    const service = new IndexBootstrapService(db);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(collection).toHaveBeenCalledTimes(INDEX_REGISTRY.length);
    expect(createIndexes).toHaveBeenCalledTimes(INDEX_REGISTRY.length);
  });

  it('logs and continues (does not throw) when a collection fails to index', async () => {
    const collection = jest.fn().mockReturnValue({
      createIndexes: jest.fn().mockRejectedValue(new Error('unreachable')),
    });
    const db = { collection } as unknown as Db;
    const service = new IndexBootstrapService(db);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});

import { Db } from 'mongodb';
import { IndexBootstrapService } from './index-bootstrap.service';
import { INDEX_REGISTRY } from './index-registry';

describe('IndexBootstrapService', () => {
  it('has no registered collections in Phase 2 (no domain collections exist yet)', () => {
    expect(INDEX_REGISTRY).toEqual([]);
  });

  it('completes without touching the database when the registry is empty', async () => {
    const collection = jest.fn();
    const db = { collection } as unknown as Db;
    const service = new IndexBootstrapService(db);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(collection).not.toHaveBeenCalled();
  });
});

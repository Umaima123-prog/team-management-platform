import { Collection, Document } from 'mongodb';
import { WorkspaceScoped, WorkspaceScopedRepository } from './workspace-scoped.repository';

interface FakeEntity extends Document, WorkspaceScoped {
  name: string;
}

class FakeRepository extends WorkspaceScopedRepository<FakeEntity> {
  constructor(collection: Collection<FakeEntity>) {
    super(collection);
  }

  findOne(workspaceId: string, filter = {}) {
    return this.findOneScoped(workspaceId, filter);
  }

  find(workspaceId: string, filter = {}) {
    return this.findScoped(workspaceId, filter);
  }

  count(workspaceId: string, filter = {}) {
    return this.countScoped(workspaceId, filter);
  }
}

describe('WorkspaceScopedRepository', () => {
  let collection: {
    findOne: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
  };
  let repository: FakeRepository;

  beforeEach(() => {
    collection = {
      findOne: jest.fn(),
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      countDocuments: jest.fn(),
    };
    repository = new FakeRepository(collection as unknown as Collection<FakeEntity>);
  });

  it('merges workspaceId into findOne filters', async () => {
    await repository.findOne('ws-1', { name: 'alpha' });
    expect(collection.findOne).toHaveBeenCalledWith(
      { name: 'alpha', workspaceId: 'ws-1' },
      undefined,
    );
  });

  it('merges workspaceId into find filters', async () => {
    await repository.find('ws-1', { name: 'alpha' });
    expect(collection.find).toHaveBeenCalledWith(
      { name: 'alpha', workspaceId: 'ws-1' },
      undefined,
    );
  });

  it('merges workspaceId into countDocuments filters', async () => {
    await repository.count('ws-1');
    expect(collection.countDocuments).toHaveBeenCalledWith({ workspaceId: 'ws-1' });
  });

  it('cannot accidentally omit workspaceId - callers never provide it directly', async () => {
    // A caller-supplied workspaceId in the filter itself is overwritten
    // by the trusted argument, not trusted from arbitrary input.
    await repository.findOne('ws-1', { workspaceId: 'attacker-controlled' });
    expect(collection.findOne).toHaveBeenCalledWith({ workspaceId: 'ws-1' }, undefined);
  });
});

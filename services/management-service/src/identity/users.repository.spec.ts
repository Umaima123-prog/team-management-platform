import { ObjectId } from 'mongodb';
import { DatabaseService } from '../database/database.service';
import { UsersRepository } from './users.repository';

describe('UsersRepository', () => {
  let collection: { findOne: jest.Mock; find: jest.Mock };
  let databaseService: { getCollection: jest.Mock };
  let repository: UsersRepository;

  beforeEach(() => {
    collection = {
      findOne: jest.fn(),
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    };
    databaseService = { getCollection: jest.fn().mockReturnValue(collection) };
    repository = new UsersRepository(databaseService as unknown as DatabaseService);
  });

  it('lists users scoped to the workspace, sorted by name', async () => {
    await repository.list('ws-1');

    expect(collection.find).toHaveBeenCalledWith({ workspaceId: 'ws-1' }, { sort: { name: 1 } });
  });

  it('findById returns null for a syntactically invalid id, without querying the database', async () => {
    const result = await repository.findById('ws-1', 'not-an-object-id');

    expect(result).toBeNull();
    expect(collection.findOne).not.toHaveBeenCalled();
  });

  it('findById scopes the lookup by workspaceId and _id', async () => {
    const id = new ObjectId().toHexString();
    collection.findOne.mockResolvedValue({ _id: new ObjectId(id), workspaceId: 'ws-1' });

    await repository.findById('ws-1', id);

    expect(collection.findOne).toHaveBeenCalledWith(
      { _id: new ObjectId(id), workspaceId: 'ws-1' },
      undefined,
    );
  });

  it('assertBelongsToWorkspace throws a stable 400 when the user does not exist in the workspace', async () => {
    collection.findOne.mockResolvedValue(null);
    const id = new ObjectId().toHexString();

    await expect(repository.assertBelongsToWorkspace('ws-1', id, 'assigneeId')).rejects.toMatchObject({
      response: {
        code: 'VALIDATION_ERROR',
        message: 'assigneeId must reference a user in the same workspace.',
      },
    });
  });

  it('assertBelongsToWorkspace resolves silently when the user exists in the workspace', async () => {
    const id = new ObjectId().toHexString();
    collection.findOne.mockResolvedValue({ _id: new ObjectId(id), workspaceId: 'ws-1' });

    await expect(repository.assertBelongsToWorkspace('ws-1', id, 'assigneeId')).resolves.toBeUndefined();
  });
});

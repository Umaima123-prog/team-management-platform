import { ObjectId } from 'mongodb';
import { RequestContext } from '../common/context/request-context';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';

describe('UsersController', () => {
  const ctx: RequestContext = { userId: 'u1', workspaceId: 'ws-1', role: 'ADMIN', correlationId: 'corr-1' };

  it('lists users for the caller\'s workspace, with id normalized from _id', async () => {
    const id = new ObjectId();
    const usersRepository = {
      list: jest.fn().mockResolvedValue([
        { _id: id, workspaceId: 'ws-1', name: 'Alice', email: 'alice@example.test' },
      ]),
    };
    const controller = new UsersController(usersRepository as unknown as UsersRepository);

    const result = await controller.list(ctx);

    expect(usersRepository.list).toHaveBeenCalledWith('ws-1');
    expect(result).toEqual({
      items: [{ id: id.toHexString(), workspaceId: 'ws-1', name: 'Alice', email: 'alice@example.test' }],
    });
  });
});

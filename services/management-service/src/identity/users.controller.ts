import { Controller, Get } from '@nestjs/common';
import { CurrentContext } from '../common/context/current-context.decorator';
import { RequestContext } from '../common/context/request-context';
import { withId } from '../common/mongo/with-id.util';
import { UsersRepository } from './users.repository';

/** List/view routes for the future UI (e.g. populating assignee pickers). */
@Controller('api/users')
export class UsersController {
  constructor(private readonly usersRepository: UsersRepository) {}

  @Get()
  async list(@CurrentContext() ctx: RequestContext) {
    const users = await this.usersRepository.list(ctx.workspaceId);
    return { items: users.map(withId) };
  }
}

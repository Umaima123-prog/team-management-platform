import { Controller, Get, Param } from '@nestjs/common';
import { CurrentContext } from '../common/context/current-context.decorator';
import { RequestContext } from '../common/context/request-context';
import { withId } from '../common/mongo/with-id.util';
import { BoardsService } from './boards.service';

@Controller('api/projects/:projectId/board')
export class BoardsController {
  constructor(private readonly boardsService: BoardsService) {}

  @Get()
  async get(@CurrentContext() ctx: RequestContext, @Param('projectId') projectId: string) {
    const board = await this.boardsService.getByProjectId(ctx.workspaceId, projectId);
    return withId(board);
  }
}

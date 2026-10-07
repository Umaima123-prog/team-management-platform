import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext } from '../common/context/current-context.decorator';
import { RequestContext } from '../common/context/request-context';
import { withId } from '../common/mongo/with-id.util';
import { ArchiveWorkItemDto } from './dto/archive-work-item.dto';
import { AssignWorkItemDto } from './dto/assign-work-item.dto';
import { CreateWorkItemDto } from './dto/create-work-item.dto';
import { ListWorkItemsQueryDto } from './dto/list-work-items-query.dto';
import { MoveWorkItemDto } from './dto/move-work-item.dto';
import { UpdateWorkItemDto } from './dto/update-work-item.dto';
import { WorkItemsService } from './work-items.service';

/** Addressable from two parent paths (project-scoped create/list,
 * item-scoped everything else) - see docs/ARCHITECTURE.md API section. */
@Controller()
export class WorkItemsController {
  constructor(private readonly workItemsService: WorkItemsService) {}

  @Post('api/projects/:projectId/items')
  async create(
    @CurrentContext() ctx: RequestContext,
    @Param('projectId') projectId: string,
    @Body() dto: CreateWorkItemDto,
  ) {
    const item = await this.workItemsService.createWorkItem(
      ctx.workspaceId,
      projectId,
      ctx.userId,
      dto,
      ctx.correlationId,
    );
    return withId(item);
  }

  @Get('api/projects/:projectId/items')
  async list(
    @CurrentContext() ctx: RequestContext,
    @Param('projectId') projectId: string,
    @Query() query: ListWorkItemsQueryDto,
  ) {
    const { items, nextCursor } = await this.workItemsService.listByProject(
      ctx.workspaceId,
      projectId,
      query,
    );
    return { items: items.map(withId), nextCursor };
  }

  @Get('api/items/:itemId')
  async get(@CurrentContext() ctx: RequestContext, @Param('itemId') itemId: string) {
    const item = await this.workItemsService.getItemOrThrow(ctx.workspaceId, itemId);
    return withId(item);
  }

  @Patch('api/items/:itemId')
  async update(
    @CurrentContext() ctx: RequestContext,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateWorkItemDto,
  ) {
    const item = await this.workItemsService.updateWorkItem(
      ctx.workspaceId,
      itemId,
      dto,
      ctx.userId,
      ctx.correlationId,
    );
    return withId(item);
  }

  @Post('api/items/:itemId/assign')
  async assign(
    @CurrentContext() ctx: RequestContext,
    @Param('itemId') itemId: string,
    @Body() dto: AssignWorkItemDto,
  ) {
    const item = await this.workItemsService.assignWorkItem(
      ctx.workspaceId,
      itemId,
      dto,
      ctx.userId,
      ctx.correlationId,
    );
    return withId(item);
  }

  @Post('api/items/:itemId/move')
  async move(
    @CurrentContext() ctx: RequestContext,
    @Param('itemId') itemId: string,
    @Body() dto: MoveWorkItemDto,
  ) {
    const item = await this.workItemsService.moveWorkItem(
      ctx.workspaceId,
      itemId,
      dto,
      ctx.userId,
      ctx.correlationId,
    );
    return withId(item);
  }

  @Post('api/items/:itemId/archive')
  async archive(
    @CurrentContext() ctx: RequestContext,
    @Param('itemId') itemId: string,
    @Body() dto: ArchiveWorkItemDto,
  ) {
    const item = await this.workItemsService.archiveWorkItem(
      ctx.workspaceId,
      itemId,
      dto.expectedVersion,
      ctx.userId,
      ctx.correlationId,
    );
    return withId(item);
  }
}

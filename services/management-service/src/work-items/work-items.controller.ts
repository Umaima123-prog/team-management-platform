import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
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

  @Roles('ADMIN')
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

  // No @Roles() here - any authenticated role may attempt this route,
  // but EMPLOYEE may only act on a work item currently assigned to
  // them. That can't be a route-level decorator (it depends on the
  // loaded item, not just the caller's role), so it's enforced inside
  // WorkItemsService.updateWorkItem via assertCanMutateAssignedItem.
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
      ctx.role,
      ctx.correlationId,
    );
    return withId(item);
  }

  @Roles('ADMIN')
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

  // Same ownership rule as update() above - enforced in
  // WorkItemsService.moveWorkItem, not here.
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
      ctx.role,
      ctx.correlationId,
    );
    return withId(item);
  }

  @Roles('ADMIN')
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

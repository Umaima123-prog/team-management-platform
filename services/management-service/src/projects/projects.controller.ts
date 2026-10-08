import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CurrentContext } from '../common/context/current-context.decorator';
import { RequestContext } from '../common/context/request-context';
import { withId } from '../common/mongo/with-id.util';
import { InsightsClientService } from '../messaging/insights/insights-client.service';
import { InsightsQueryOutcome } from '../messaging/insights/insights.types';
import { ActivityClientService } from '../messaging/activity/activity-client.service';
import { ActivityQueryOutcome } from '../messaging/activity/activity.types';
import { ArchiveProjectDto } from './dto/archive-project.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

@Controller('api/projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly insightsClient: InsightsClientService,
    private readonly activityClient: ActivityClientService,
  ) {}

  @Roles('ADMIN')
  @Post()
  async create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateProjectDto) {
    const project = await this.projectsService.createProject(ctx.workspaceId, dto, ctx.userId, ctx.correlationId);
    return withId(project);
  }

  @Get()
  async list(
    @CurrentContext() ctx: RequestContext,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const projects = await this.projectsService.listProjects(
      ctx.workspaceId,
      includeArchived === 'true',
    );
    return { items: projects.map(withId) };
  }

  @Get(':projectId')
  async get(@CurrentContext() ctx: RequestContext, @Param('projectId') projectId: string) {
    const project = await this.projectsService.getProjectOrThrow(ctx.workspaceId, projectId);
    return withId(project);
  }

  @Roles('ADMIN')
  @Patch(':projectId')
  async update(
    @CurrentContext() ctx: RequestContext,
    @Param('projectId') projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    const project = await this.projectsService.updateProject(
      ctx.workspaceId,
      projectId,
      dto,
      ctx.userId,
      ctx.correlationId,
    );
    return withId(project);
  }

  @Roles('ADMIN')
  @Post(':projectId/archive')
  async archive(
    @CurrentContext() ctx: RequestContext,
    @Param('projectId') projectId: string,
    @Body() dto: ArchiveProjectDto,
  ) {
    const project = await this.projectsService.archiveProject(
      ctx.workspaceId,
      projectId,
      dto.expectedVersion,
    );
    return withId(project);
  }

  /**
   * Synchronous insight query over Core NATS request/reply (assignment
   * section 9 "GET /api/projects/{projectId}/insights ... with timeout
   * and graceful fallback"). Always 200 - "pending"/"unavailable" are
   * legitimate, typed states (TM-12), not server errors; only an
   * unknown projectId is a 404.
   */
  @Get(':projectId/insights')
  async insights(
    @CurrentContext() ctx: RequestContext,
    @Param('projectId') projectId: string,
  ): Promise<InsightsQueryOutcome> {
    await this.projectsService.getProjectOrThrow(ctx.workspaceId, projectId);
    return this.insightsClient.getProjectInsights(projectId, ctx.workspaceId, ctx.correlationId);
  }

  /**
   * Phase 6 admin UI's Activity screen: the project's real,
   * asynchronously-built activity timeline, proxied over Core NATS
   * request/reply exactly like `insights` above - never a direct
   * browser read of insights_db, never a different contract shape.
   * Always 200 with a typed status; only an unknown projectId is 404.
   */
  @Get(':projectId/activity')
  async activity(
    @CurrentContext() ctx: RequestContext,
    @Param('projectId') projectId: string,
  ): Promise<ActivityQueryOutcome> {
    await this.projectsService.getProjectOrThrow(ctx.workspaceId, projectId);
    return this.activityClient.getProjectActivity(projectId, ctx.workspaceId, ctx.correlationId);
  }
}

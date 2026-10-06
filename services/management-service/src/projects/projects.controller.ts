import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext } from '../common/context/current-context.decorator';
import { RequestContext } from '../common/context/request-context';
import { withId } from '../common/mongo/with-id.util';
import { ArchiveProjectDto } from './dto/archive-project.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

@Controller('api/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  async create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateProjectDto) {
    const project = await this.projectsService.createProject(ctx.workspaceId, dto);
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

  @Patch(':projectId')
  async update(
    @CurrentContext() ctx: RequestContext,
    @Param('projectId') projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    const project = await this.projectsService.updateProject(ctx.workspaceId, projectId, dto);
    return withId(project);
  }

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
}

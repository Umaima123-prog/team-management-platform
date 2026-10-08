import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentContext } from '../common/context/current-context.decorator';
import { RequestContext } from '../common/context/request-context';
import { withId } from '../common/mongo/with-id.util';
import { Roles } from '../auth/roles.decorator';
import { AddMemberDto } from './dto/add-member.dto';
import { ArchiveTeamDto } from './dto/archive-team.dto';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { TeamsService } from './teams.service';

@Controller('api/teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Roles('ADMIN')
  @Post()
  async create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateTeamDto) {
    const team = await this.teamsService.createTeam(ctx.workspaceId, ctx.userId, dto, ctx.correlationId);
    return withId(team);
  }

  @Get()
  async list(
    @CurrentContext() ctx: RequestContext,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const teams = await this.teamsService.listTeams(ctx.workspaceId, includeArchived === 'true');
    return { items: teams.map(withId) };
  }

  @Get(':teamId')
  async get(@CurrentContext() ctx: RequestContext, @Param('teamId') teamId: string) {
    const { team, members } = await this.teamsService.getTeamWithMembers(ctx.workspaceId, teamId);
    return { ...withId(team), members: members.map(withId) };
  }

  @Roles('ADMIN')
  @Patch(':teamId')
  async update(
    @CurrentContext() ctx: RequestContext,
    @Param('teamId') teamId: string,
    @Body() dto: UpdateTeamDto,
  ) {
    const team = await this.teamsService.updateTeam(ctx.workspaceId, teamId, ctx.userId, dto);
    return withId(team);
  }

  @Roles('ADMIN')
  @Post(':teamId/archive')
  async archive(
    @CurrentContext() ctx: RequestContext,
    @Param('teamId') teamId: string,
    @Body() dto: ArchiveTeamDto,
  ) {
    const team = await this.teamsService.archiveTeam(
      ctx.workspaceId,
      teamId,
      ctx.userId,
      dto.expectedVersion,
    );
    return withId(team);
  }

  @Roles('ADMIN')
  @Post(':teamId/members')
  async addMember(
    @CurrentContext() ctx: RequestContext,
    @Param('teamId') teamId: string,
    @Body() dto: AddMemberDto,
  ) {
    const membership = await this.teamsService.addMember(
      ctx.workspaceId,
      teamId,
      ctx.userId,
      dto,
      ctx.correlationId,
    );
    return withId(membership);
  }

  @Roles('ADMIN')
  @Patch(':teamId/members/:userId')
  async updateMemberRole(
    @CurrentContext() ctx: RequestContext,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    const membership = await this.teamsService.updateMemberRole(
      ctx.workspaceId,
      teamId,
      userId,
      ctx.userId,
      dto,
    );
    return withId(membership);
  }

  @Roles('ADMIN')
  @Delete(':teamId/members/:userId')
  async removeMember(
    @CurrentContext() ctx: RequestContext,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
  ) {
    const membership = await this.teamsService.removeMember(
      ctx.workspaceId,
      teamId,
      userId,
      ctx.userId,
    );
    return withId(membership);
  }
}

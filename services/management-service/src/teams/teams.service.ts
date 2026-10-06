import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { UsersRepository } from '../identity/users.repository';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { MembershipsRepository } from './memberships.repository';
import { TeamRole } from './membership.schema';
import { TeamsRepository } from './teams.repository';

const MANAGE_TEAM_ROLES: TeamRole[] = ['OWNER', 'LEAD'];

@Injectable()
export class TeamsService {
  constructor(
    private readonly teamsRepository: TeamsRepository,
    private readonly membershipsRepository: MembershipsRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  async getTeamOrThrow(workspaceId: string, teamId: string) {
    const team = await this.teamsRepository.findById(workspaceId, teamId);
    if (!team) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Team not found.' });
    }
    return team;
  }

  async assertRequesterCanManage(workspaceId: string, teamId: string, requesterId: string): Promise<void> {
    const membership = await this.membershipsRepository.findActive(workspaceId, teamId, requesterId);
    if (!membership || !MANAGE_TEAM_ROLES.includes(membership.role)) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN,
        message: 'Only an OWNER or LEAD of this team may perform this action.',
      });
    }
  }

  private assertNotArchived(team: { archivedAt: Date | null }): void {
    if (team.archivedAt) {
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: 'This team is archived and cannot be modified.',
      });
    }
  }

  async createTeam(workspaceId: string, creatorUserId: string, dto: CreateTeamDto) {
    const team = await this.teamsRepository.create({
      workspaceId,
      code: dto.code,
      name: dto.name,
      description: dto.description ?? null,
    });
    // The creator becomes the team's first OWNER - there is no one else
    // to authorize this against yet.
    await this.membershipsRepository.addMember(workspaceId, team._id.toHexString(), creatorUserId, 'OWNER');
    return team;
  }

  listTeams(workspaceId: string, includeArchived: boolean) {
    return this.teamsRepository.list(workspaceId, includeArchived);
  }

  async getTeamWithMembers(workspaceId: string, teamId: string) {
    const team = await this.getTeamOrThrow(workspaceId, teamId);
    const members = await this.membershipsRepository.listByTeam(workspaceId, teamId);
    return { team, members };
  }

  async updateTeam(workspaceId: string, teamId: string, requesterId: string, dto: UpdateTeamDto) {
    const team = await this.getTeamOrThrow(workspaceId, teamId);
    this.assertNotArchived(team);
    await this.assertRequesterCanManage(workspaceId, teamId, requesterId);

    const patch: Partial<{ name: string; description: string | null }> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;

    return this.teamsRepository.updateDetails(workspaceId, teamId, dto.expectedVersion, patch);
  }

  async archiveTeam(workspaceId: string, teamId: string, requesterId: string, expectedVersion: number) {
    const team = await this.getTeamOrThrow(workspaceId, teamId);
    this.assertNotArchived(team);
    const membership = await this.membershipsRepository.findActive(workspaceId, teamId, requesterId);
    if (!membership || membership.role !== 'OWNER') {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN,
        message: 'Only an OWNER of this team may archive it.',
      });
    }
    return this.teamsRepository.archive(workspaceId, teamId, expectedVersion);
  }

  async addMember(workspaceId: string, teamId: string, requesterId: string, dto: AddMemberDto) {
    const team = await this.getTeamOrThrow(workspaceId, teamId);
    this.assertNotArchived(team);
    await this.assertRequesterCanManage(workspaceId, teamId, requesterId);
    await this.usersRepository.assertBelongsToWorkspace(workspaceId, dto.userId, 'userId');
    return this.membershipsRepository.addMember(workspaceId, teamId, dto.userId, dto.role);
  }

  async updateMemberRole(
    workspaceId: string,
    teamId: string,
    targetUserId: string,
    requesterId: string,
    dto: UpdateMemberRoleDto,
  ) {
    const team = await this.getTeamOrThrow(workspaceId, teamId);
    this.assertNotArchived(team);
    await this.assertRequesterCanManage(workspaceId, teamId, requesterId);
    return this.membershipsRepository.updateRole(workspaceId, teamId, targetUserId, dto.role);
  }

  async removeMember(workspaceId: string, teamId: string, targetUserId: string, requesterId: string) {
    const team = await this.getTeamOrThrow(workspaceId, teamId);
    this.assertNotArchived(team);
    await this.assertRequesterCanManage(workspaceId, teamId, requesterId);
    return this.membershipsRepository.remove(workspaceId, teamId, targetUserId);
  }
}

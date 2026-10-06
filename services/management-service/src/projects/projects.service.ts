import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { BoardsService } from '../boards/boards.service';
import { TeamsRepository } from '../teams/teams.repository';
import { UsersRepository } from '../identity/users.repository';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsRepository } from './projects.repository';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly teamsRepository: TeamsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly boardsService: BoardsService,
  ) {}

  async getProjectOrThrow(workspaceId: string, projectId: string) {
    const project = await this.projectsRepository.findById(workspaceId, projectId);
    if (!project) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Project not found.' });
    }
    return project;
  }

  private async assertTeamIsUsable(workspaceId: string, teamId: string): Promise<void> {
    const team = await this.teamsRepository.findById(workspaceId, teamId);
    if (!team) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'teamId must reference a team in the same workspace.',
      });
    }
    if (team.archivedAt) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'teamId must reference a team that is not archived.',
      });
    }
  }

  async createProject(workspaceId: string, dto: CreateProjectDto) {
    await this.usersRepository.assertBelongsToWorkspace(workspaceId, dto.ownerId, 'ownerId');
    await this.assertTeamIsUsable(workspaceId, dto.teamId);

    const project = await this.projectsRepository.create({
      workspaceId,
      projectKey: dto.projectKey,
      name: dto.name,
      description: dto.description ?? null,
      ownerId: dto.ownerId,
      teamId: dto.teamId,
      startDate: dto.startDate ?? null,
      endDate: dto.endDate ?? null,
    });

    await this.boardsService.createDefaultBoard(workspaceId, project._id.toHexString());
    return project;
  }

  listProjects(workspaceId: string, includeArchived: boolean) {
    return this.projectsRepository.list(workspaceId, includeArchived);
  }

  async updateProject(workspaceId: string, projectId: string, dto: UpdateProjectDto) {
    await this.getProjectOrThrow(workspaceId, projectId);

    if (dto.ownerId !== undefined) {
      await this.usersRepository.assertBelongsToWorkspace(workspaceId, dto.ownerId, 'ownerId');
    }
    if (dto.teamId !== undefined) {
      await this.assertTeamIsUsable(workspaceId, dto.teamId);
    }

    const patch: Partial<{
      name: string;
      description: string | null;
      ownerId: string;
      teamId: string;
      startDate: Date | null;
      endDate: Date | null;
    }> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.ownerId !== undefined) patch.ownerId = dto.ownerId;
    if (dto.teamId !== undefined) patch.teamId = dto.teamId;
    if (dto.startDate !== undefined) patch.startDate = dto.startDate;
    if (dto.endDate !== undefined) patch.endDate = dto.endDate;

    return this.projectsRepository.updateDetails(workspaceId, projectId, dto.expectedVersion, patch);
  }

  async archiveProject(workspaceId: string, projectId: string, expectedVersion: number) {
    await this.getProjectOrThrow(workspaceId, projectId);
    return this.projectsRepository.archive(workspaceId, projectId, expectedVersion);
  }
}

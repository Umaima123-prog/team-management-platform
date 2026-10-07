import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../messaging/outbox/outbox.service';
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
    private readonly databaseService: DatabaseService,
    private readonly outboxService: OutboxService,
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

  /**
   * Creates the project, assigns its owning team, and creates its
   * default board - all in one transaction, emitting three documented
   * facts (project.created, project.team_assigned, board.created) per
   * the assignment's Minimum API surface table ("Create project,
   * assign team, create default board, and emit facts"). project.team_assigned
   * and board.created both carry causationId = project.created's
   * eventId, since they are direct consequences of the same root fact
   * within this one command (see docs/DECISIONS.md for the
   * causationId-chaining convention).
   */
  async createProject(workspaceId: string, dto: CreateProjectDto, actorId: string, correlationId: string) {
    await this.usersRepository.assertBelongsToWorkspace(workspaceId, dto.ownerId, 'ownerId');
    await this.assertTeamIsUsable(workspaceId, dto.teamId);

    return this.databaseService.withTransaction(async (session) => {
      const project = await this.projectsRepository.create(
        {
          workspaceId,
          projectKey: dto.projectKey,
          name: dto.name,
          description: dto.description ?? null,
          ownerId: dto.ownerId,
          teamId: dto.teamId,
          startDate: dto.startDate ?? null,
          endDate: dto.endDate ?? null,
        },
        session,
      );
      const projectId = project._id.toHexString();

      const rootEnvelope = await this.outboxService.enqueue(session, {
        workspaceId,
        eventType: 'project.created',
        aggregateType: 'Project',
        aggregateId: projectId,
        aggregateVersion: project.version,
        correlationId,
        causationId: null,
        actorId,
        // projectId/workspaceId are not repeated - already on
        // envelope.aggregate.id and envelope.workspaceId.
        payload: {
          projectKey: project.projectKey,
          name: project.name,
          teamId: project.teamId,
          ownerId: project.ownerId,
        },
      });

      await this.outboxService.enqueue(session, {
        workspaceId,
        eventType: 'project.team_assigned',
        aggregateType: 'Project',
        aggregateId: projectId,
        aggregateVersion: project.version,
        correlationId,
        causationId: rootEnvelope.eventId,
        actorId,
        payload: { teamId: project.teamId, previousTeamId: null },
      });

      const board = await this.boardsService.createDefaultBoard(workspaceId, projectId, session);
      await this.outboxService.enqueue(session, {
        workspaceId,
        eventType: 'board.created',
        aggregateType: 'Board',
        aggregateId: board._id.toHexString(),
        aggregateVersion: board.version,
        correlationId,
        causationId: rootEnvelope.eventId,
        actorId,
        payload: {
          boardId: board._id.toHexString(),
          projectId,
          columns: board.columns.map((c) => ({ id: c.id, name: c.name, order: c.order })),
        },
      });

      return project;
    });
  }

  listProjects(workspaceId: string, includeArchived: boolean) {
    return this.projectsRepository.list(workspaceId, includeArchived);
  }

  async updateProject(
    workspaceId: string,
    projectId: string,
    dto: UpdateProjectDto,
    actorId: string,
    correlationId: string,
  ) {
    const project = await this.getProjectOrThrow(workspaceId, projectId);

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

    // project.team_assigned is the documented fact for "a project's
    // owning team changed" (assignment subject catalogue) - re-used
    // here (not a new subject) whenever a PATCH actually changes
    // teamId, not only at creation. See docs/DECISIONS.md.
    const teamIsChanging = dto.teamId !== undefined && dto.teamId !== project.teamId;
    if (!teamIsChanging) {
      return this.projectsRepository.updateDetails(workspaceId, projectId, dto.expectedVersion, patch);
    }

    return this.databaseService.withTransaction(async (session) => {
      const updated = await this.projectsRepository.updateDetails(
        workspaceId,
        projectId,
        dto.expectedVersion,
        patch,
        session,
      );

      await this.outboxService.enqueue(session, {
        workspaceId,
        eventType: 'project.team_assigned',
        aggregateType: 'Project',
        aggregateId: projectId,
        aggregateVersion: updated.version,
        correlationId,
        causationId: null,
        actorId,
        payload: { teamId: updated.teamId, previousTeamId: project.teamId },
      });

      return updated;
    });
  }

  async archiveProject(workspaceId: string, projectId: string, expectedVersion: number) {
    await this.getProjectOrThrow(workspaceId, projectId);
    return this.projectsRepository.archive(workspaceId, projectId, expectedVersion);
  }
}

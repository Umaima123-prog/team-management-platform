import { BadRequestException } from '@nestjs/common';
import { ClientSession } from 'mongodb';
import { BoardsService } from '../boards/boards.service';
import { DatabaseService } from '../database/database.service';
import { EnqueueEventInput, OutboxService } from '../messaging/outbox/outbox.service';
import { UsersRepository } from '../identity/users.repository';
import { TeamsRepository } from '../teams/teams.repository';
import { ProjectsRepository } from './projects.repository';
import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  let projectsRepository: {
    create: jest.Mock;
    findById: jest.Mock;
    list: jest.Mock;
    updateDetails: jest.Mock;
    archive: jest.Mock;
  };
  let teamsRepository: { findById: jest.Mock };
  let usersRepository: { assertBelongsToWorkspace: jest.Mock };
  let boardsService: { createDefaultBoard: jest.Mock };
  let databaseService: { withTransaction: jest.Mock };
  let outboxService: { enqueue: jest.Mock };
  let service: ProjectsService;

  const WORKSPACE = 'ws-1';
  const ACTOR = 'actor-1';
  const CORRELATION_ID = 'corr-1';
  const FAKE_SESSION = {} as ClientSession;
  const baseDto = {
    projectKey: 'PAY',
    name: 'Payments',
    ownerId: 'owner-1',
    teamId: 'team-1',
  };

  beforeEach(() => {
    projectsRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      list: jest.fn(),
      updateDetails: jest.fn(),
      archive: jest.fn(),
    };
    teamsRepository = { findById: jest.fn() };
    usersRepository = { assertBelongsToWorkspace: jest.fn().mockResolvedValue(undefined) };
    boardsService = { createDefaultBoard: jest.fn() };
    databaseService = {
      withTransaction: jest.fn((fn: (session: ClientSession) => Promise<unknown>) => fn(FAKE_SESSION)),
    };
    let eventCounter = 0;
    outboxService = {
      enqueue: jest.fn((_session: ClientSession, input: EnqueueEventInput) =>
        Promise.resolve({
          eventId: `evt-${++eventCounter}`,
          eventType: input.eventType,
          schemaVersion: 1,
          occurredAt: new Date().toISOString(),
          producer: 'management-service',
          workspaceId: input.workspaceId,
          aggregate: { type: input.aggregateType, id: input.aggregateId, version: input.aggregateVersion },
          correlationId: input.correlationId,
          causationId: input.causationId,
          actorId: input.actorId,
          payload: input.payload,
        }),
      ),
    };
    service = new ProjectsService(
      projectsRepository as unknown as ProjectsRepository,
      teamsRepository as unknown as TeamsRepository,
      usersRepository as unknown as UsersRepository,
      boardsService as unknown as BoardsService,
      databaseService as unknown as DatabaseService,
      outboxService as unknown as OutboxService,
    );
  });

  describe('createProject', () => {
    it('rejects an ownerId that is not a user in this workspace, before opening a transaction', async () => {
      usersRepository.assertBelongsToWorkspace.mockRejectedValue(
        new BadRequestException('cross-workspace owner'),
      );

      await expect(
        service.createProject(WORKSPACE, baseDto as never, ACTOR, CORRELATION_ID),
      ).rejects.toThrow(BadRequestException);
      expect(projectsRepository.create).not.toHaveBeenCalled();
      expect(databaseService.withTransaction).not.toHaveBeenCalled();
      expect(outboxService.enqueue).not.toHaveBeenCalled();
    });

    it('rejects a teamId that does not resolve to a team in this workspace', async () => {
      teamsRepository.findById.mockResolvedValue(null);

      await expect(
        service.createProject(WORKSPACE, baseDto as never, ACTOR, CORRELATION_ID),
      ).rejects.toThrow(BadRequestException);
      expect(projectsRepository.create).not.toHaveBeenCalled();
    });

    it('rejects an archived team as the owning team', async () => {
      teamsRepository.findById.mockResolvedValue({ archivedAt: new Date() });

      await expect(
        service.createProject(WORKSPACE, baseDto as never, ACTOR, CORRELATION_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates the project and its default board once owner/team validate', async () => {
      teamsRepository.findById.mockResolvedValue({ archivedAt: null });
      const project = {
        _id: { toHexString: () => 'proj-1' },
        projectKey: 'PAY',
        name: 'Payments',
        teamId: 'team-1',
        ownerId: 'owner-1',
        version: 1,
      };
      projectsRepository.create.mockResolvedValue(project);
      const board = {
        _id: { toHexString: () => 'board-1' },
        version: 1,
        columns: [{ id: 'c1', name: 'Backlog', order: 0, wipLimit: null }],
      };
      boardsService.createDefaultBoard.mockResolvedValue(board);

      const result = await service.createProject(WORKSPACE, baseDto, ACTOR, CORRELATION_ID);

      expect(result).toBe(project);
      expect(boardsService.createDefaultBoard).toHaveBeenCalledWith(WORKSPACE, 'proj-1', FAKE_SESSION);
    });

    it('emits project.created, project.team_assigned, and board.created, all inside one transaction, with the first two facts chained via causationId', async () => {
      teamsRepository.findById.mockResolvedValue({ archivedAt: null });
      const project = {
        _id: { toHexString: () => 'proj-1' },
        projectKey: 'PAY',
        name: 'Payments',
        teamId: 'team-1',
        ownerId: 'owner-1',
        version: 1,
      };
      projectsRepository.create.mockResolvedValue(project);
      const board = {
        _id: { toHexString: () => 'board-1' },
        version: 1,
        columns: [{ id: 'c1', name: 'Backlog', order: 0, wipLimit: null }],
      };
      boardsService.createDefaultBoard.mockResolvedValue(board);

      await service.createProject(WORKSPACE, baseDto, ACTOR, CORRELATION_ID);

      expect(databaseService.withTransaction).toHaveBeenCalledTimes(1);
      expect(outboxService.enqueue).toHaveBeenCalledTimes(3);

      const [createdCall, teamAssignedCall, boardCreatedCall] = outboxService.enqueue.mock.calls as [
        unknown,
        EnqueueEventInput,
      ][];
      expect(createdCall[1]).toMatchObject({ eventType: 'project.created', causationId: null });
      expect(teamAssignedCall[1]).toMatchObject({
        eventType: 'project.team_assigned',
        causationId: 'evt-1',
        payload: { teamId: 'team-1', previousTeamId: null },
      });
      expect(boardCreatedCall[1]).toMatchObject({ eventType: 'board.created', causationId: 'evt-1' });
    });

    it('creates no outbox events when the project insert itself fails (e.g. duplicate projectKey)', async () => {
      teamsRepository.findById.mockResolvedValue({ archivedAt: null });
      projectsRepository.create.mockRejectedValue(new Error('duplicate key'));

      await expect(service.createProject(WORKSPACE, baseDto, ACTOR, CORRELATION_ID)).rejects.toThrow();
      expect(boardsService.createDefaultBoard).not.toHaveBeenCalled();
      expect(outboxService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('updateProject', () => {
    it('only sends the fields that were actually provided in the patch, and skips the transaction/outbox when teamId is unchanged', async () => {
      projectsRepository.findById.mockResolvedValue({ _id: 'p1', teamId: 'team-1' });
      projectsRepository.updateDetails.mockResolvedValue({ _id: 'p1', version: 2 });

      await service.updateProject(
        WORKSPACE,
        'p1',
        { expectedVersion: 1, name: 'New Name' },
        ACTOR,
        CORRELATION_ID,
      );

      expect(projectsRepository.updateDetails).toHaveBeenCalledWith(WORKSPACE, 'p1', 1, {
        name: 'New Name',
      });
      expect(databaseService.withTransaction).not.toHaveBeenCalled();
      expect(outboxService.enqueue).not.toHaveBeenCalled();
    });

    it('re-validates teamId against the workspace/archived rules when changing team', async () => {
      projectsRepository.findById.mockResolvedValue({ _id: 'p1', teamId: 'team-1' });
      teamsRepository.findById.mockResolvedValue(null);

      await expect(
        service.updateProject(
          WORKSPACE,
          'p1',
          { expectedVersion: 1, teamId: 'other-team' },
          ACTOR,
          CORRELATION_ID,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(projectsRepository.updateDetails).not.toHaveBeenCalled();
      expect(outboxService.enqueue).not.toHaveBeenCalled();
    });

    it('emits project.team_assigned (reusing the documented subject, not a new one) when a PATCH actually changes teamId', async () => {
      projectsRepository.findById.mockResolvedValue({ _id: 'p1', teamId: 'team-1' });
      teamsRepository.findById.mockResolvedValue({ archivedAt: null });
      projectsRepository.updateDetails.mockResolvedValue({ _id: 'p1', teamId: 'team-2', version: 2 });

      await service.updateProject(
        WORKSPACE,
        'p1',
        { expectedVersion: 1, teamId: 'team-2' },
        ACTOR,
        CORRELATION_ID,
      );

      expect(databaseService.withTransaction).toHaveBeenCalledTimes(1);
      expect(outboxService.enqueue).toHaveBeenCalledWith(FAKE_SESSION, {
        workspaceId: WORKSPACE,
        eventType: 'project.team_assigned',
        aggregateType: 'Project',
        aggregateId: 'p1',
        aggregateVersion: 2,
        correlationId: CORRELATION_ID,
        causationId: null,
        actorId: ACTOR,
        payload: { teamId: 'team-2', previousTeamId: 'team-1' },
      });
    });
  });
});

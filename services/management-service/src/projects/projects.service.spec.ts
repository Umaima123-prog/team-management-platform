import { BadRequestException } from '@nestjs/common';
import { BoardsService } from '../boards/boards.service';
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
  let service: ProjectsService;

  const WORKSPACE = 'ws-1';
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
    service = new ProjectsService(
      projectsRepository as unknown as ProjectsRepository,
      teamsRepository as unknown as TeamsRepository,
      usersRepository as unknown as UsersRepository,
      boardsService as unknown as BoardsService,
    );
  });

  describe('createProject', () => {
    it('rejects an ownerId that is not a user in this workspace', async () => {
      usersRepository.assertBelongsToWorkspace.mockRejectedValue(
        new BadRequestException('cross-workspace owner'),
      );

      await expect(service.createProject(WORKSPACE, baseDto as never)).rejects.toThrow(
        BadRequestException,
      );
      expect(projectsRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a teamId that does not resolve to a team in this workspace', async () => {
      teamsRepository.findById.mockResolvedValue(null);

      await expect(service.createProject(WORKSPACE, baseDto as never)).rejects.toThrow(
        BadRequestException,
      );
      expect(projectsRepository.create).not.toHaveBeenCalled();
    });

    it('rejects an archived team as the owning team', async () => {
      teamsRepository.findById.mockResolvedValue({ archivedAt: new Date() });

      await expect(service.createProject(WORKSPACE, baseDto as never)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates the project and its default board once owner/team validate', async () => {
      teamsRepository.findById.mockResolvedValue({ archivedAt: null });
      const project = { _id: { toHexString: () => 'proj-1' }, projectKey: 'PAY', version: 1 };
      projectsRepository.create.mockResolvedValue(project);

      const result = await service.createProject(WORKSPACE, baseDto);

      expect(result).toBe(project);
      expect(boardsService.createDefaultBoard).toHaveBeenCalledWith(WORKSPACE, 'proj-1');
    });
  });

  describe('updateProject', () => {
    it('only sends the fields that were actually provided in the patch', async () => {
      projectsRepository.findById.mockResolvedValue({ _id: 'p1' });
      projectsRepository.updateDetails.mockResolvedValue({ _id: 'p1', version: 2 });

      await service.updateProject(WORKSPACE, 'p1', {
        expectedVersion: 1,
        name: 'New Name',
      });

      expect(projectsRepository.updateDetails).toHaveBeenCalledWith(WORKSPACE, 'p1', 1, {
        name: 'New Name',
      });
    });

    it('re-validates teamId against the workspace/archived rules when changing team', async () => {
      projectsRepository.findById.mockResolvedValue({ _id: 'p1' });
      teamsRepository.findById.mockResolvedValue(null);

      await expect(
        service.updateProject(WORKSPACE, 'p1', { expectedVersion: 1, teamId: 'other-team' }),
      ).rejects.toThrow(BadRequestException);
      expect(projectsRepository.updateDetails).not.toHaveBeenCalled();
    });
  });
});

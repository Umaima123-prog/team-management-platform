import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UsersRepository } from '../identity/users.repository';
import { MembershipsRepository } from './memberships.repository';
import { TeamsRepository } from './teams.repository';
import { TeamsService } from './teams.service';

describe('TeamsService', () => {
  let teamsRepository: {
    create: jest.Mock;
    findById: jest.Mock;
    list: jest.Mock;
    updateDetails: jest.Mock;
    archive: jest.Mock;
  };
  let membershipsRepository: {
    addMember: jest.Mock;
    findActive: jest.Mock;
    listByTeam: jest.Mock;
    updateRole: jest.Mock;
    remove: jest.Mock;
  };
  let usersRepository: { assertBelongsToWorkspace: jest.Mock };
  let service: TeamsService;

  const WORKSPACE = 'ws-1';
  const TEAM_ID = 'team-1';
  const REQUESTER = 'user-1';

  beforeEach(() => {
    teamsRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      list: jest.fn(),
      updateDetails: jest.fn(),
      archive: jest.fn(),
    };
    membershipsRepository = {
      addMember: jest.fn(),
      findActive: jest.fn(),
      listByTeam: jest.fn(),
      updateRole: jest.fn(),
      remove: jest.fn(),
    };
    usersRepository = { assertBelongsToWorkspace: jest.fn() };
    service = new TeamsService(
      teamsRepository as unknown as TeamsRepository,
      membershipsRepository as unknown as MembershipsRepository,
      usersRepository as unknown as UsersRepository,
    );
  });

  describe('createTeam', () => {
    it('creates the team and makes the creator its first OWNER', async () => {
      const team = {
        _id: { toHexString: () => TEAM_ID },
        code: 'PAY',
        workspaceId: WORKSPACE,
        version: 1,
      };
      teamsRepository.create.mockResolvedValue(team);

      const result = await service.createTeam(WORKSPACE, REQUESTER, {
        code: 'PAY',
        name: 'Payments',
      });

      expect(result).toBe(team);
      expect(membershipsRepository.addMember).toHaveBeenCalledWith(WORKSPACE, TEAM_ID, REQUESTER, 'OWNER');
    });

    it('propagates a duplicate-code conflict from the repository unchanged', async () => {
      teamsRepository.create.mockRejectedValue(new ConflictException('dup'));

      await expect(
        service.createTeam(WORKSPACE, REQUESTER, { code: 'PAY', name: 'Payments' }),
      ).rejects.toThrow(ConflictException);
      expect(membershipsRepository.addMember).not.toHaveBeenCalled();
    });
  });

  describe('authorization on mutation', () => {
    const team = { _id: TEAM_ID, workspaceId: WORKSPACE, archivedAt: null, version: 1 };

    beforeEach(() => {
      teamsRepository.findById.mockResolvedValue(team);
    });

    it('allows an OWNER to update team details', async () => {
      membershipsRepository.findActive.mockResolvedValue({ role: 'OWNER' });
      teamsRepository.updateDetails.mockResolvedValue({ ...team, name: 'New Name', version: 2 });

      await service.updateTeam(WORKSPACE, TEAM_ID, REQUESTER, { expectedVersion: 1, name: 'New Name' });

      expect(teamsRepository.updateDetails).toHaveBeenCalledWith(WORKSPACE, TEAM_ID, 1, {
        name: 'New Name',
      });
    });

    it('allows a LEAD to update team details', async () => {
      membershipsRepository.findActive.mockResolvedValue({ role: 'LEAD' });
      teamsRepository.updateDetails.mockResolvedValue(team);

      await expect(
        service.updateTeam(WORKSPACE, TEAM_ID, REQUESTER, { expectedVersion: 1 }),
      ).resolves.toBeDefined();
    });

    it('rejects a plain MEMBER from updating team details', async () => {
      membershipsRepository.findActive.mockResolvedValue({ role: 'MEMBER' });

      await expect(
        service.updateTeam(WORKSPACE, TEAM_ID, REQUESTER, { expectedVersion: 1, name: 'x' }),
      ).rejects.toThrow(ForbiddenException);
      expect(teamsRepository.updateDetails).not.toHaveBeenCalled();
    });

    it('rejects a non-member entirely', async () => {
      membershipsRepository.findActive.mockResolvedValue(null);

      await expect(
        service.addMember(WORKSPACE, TEAM_ID, REQUESTER, { userId: 'u2', role: 'MEMBER' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('only an OWNER (not a LEAD) may archive the team', async () => {
      membershipsRepository.findActive.mockResolvedValue({ role: 'LEAD' });

      await expect(
        service.archiveTeam(WORKSPACE, TEAM_ID, REQUESTER, 1),
      ).rejects.toThrow(ForbiddenException);
      expect(teamsRepository.archive).not.toHaveBeenCalled();
    });

    it('refuses to modify an already-archived team', async () => {
      teamsRepository.findById.mockResolvedValue({ ...team, archivedAt: new Date() });

      await expect(
        service.updateTeam(WORKSPACE, TEAM_ID, REQUESTER, { expectedVersion: 1, name: 'x' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('addMember', () => {
    const team = { _id: TEAM_ID, workspaceId: WORKSPACE, archivedAt: null, version: 1 };

    beforeEach(() => {
      teamsRepository.findById.mockResolvedValue(team);
      membershipsRepository.findActive.mockResolvedValue({ role: 'OWNER' });
    });

    it('validates the target user belongs to the same workspace before adding', async () => {
      usersRepository.assertBelongsToWorkspace.mockRejectedValue(new Error('cross-workspace'));

      await expect(
        service.addMember(WORKSPACE, TEAM_ID, REQUESTER, { userId: 'other-ws-user', role: 'MEMBER' }),
      ).rejects.toThrow();
      expect(membershipsRepository.addMember).not.toHaveBeenCalled();
    });

    it('adds the member once validation passes', async () => {
      usersRepository.assertBelongsToWorkspace.mockResolvedValue(undefined);
      const membership = { teamId: TEAM_ID, userId: 'u2', role: 'MEMBER' };
      membershipsRepository.addMember.mockResolvedValue(membership);

      const result = await service.addMember(WORKSPACE, TEAM_ID, REQUESTER, {
        userId: 'u2',
        role: 'MEMBER',
      });

      expect(result).toBe(membership);
    });
  });
});

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ClientSession } from 'mongodb';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../messaging/outbox/outbox.service';
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
  let databaseService: { withTransaction: jest.Mock };
  let outboxService: { enqueue: jest.Mock };
  let service: TeamsService;

  const WORKSPACE = 'ws-1';
  const TEAM_ID = 'team-1';
  const REQUESTER = 'user-1';
  const CORRELATION_ID = 'corr-1';
  const FAKE_SESSION = {} as ClientSession;

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
    // Mimics DatabaseService.withTransaction: runs fn against a fake
    // session and returns fn's result - same shape real callers get.
    databaseService = {
      withTransaction: jest.fn(async (fn: (session: ClientSession) => Promise<unknown>) => fn(FAKE_SESSION)),
    };
    outboxService = { enqueue: jest.fn().mockResolvedValue(undefined) };
    service = new TeamsService(
      teamsRepository as unknown as TeamsRepository,
      membershipsRepository as unknown as MembershipsRepository,
      usersRepository as unknown as UsersRepository,
      databaseService as unknown as DatabaseService,
      outboxService as unknown as OutboxService,
    );
  });

  describe('createTeam', () => {
    it('creates the team and makes the creator its first OWNER, inside one transaction', async () => {
      const team = {
        _id: { toHexString: () => TEAM_ID },
        code: 'PAY',
        name: 'Payments',
        workspaceId: WORKSPACE,
        version: 1,
      };
      teamsRepository.create.mockResolvedValue(team);

      const result = await service.createTeam(
        WORKSPACE,
        REQUESTER,
        { code: 'PAY', name: 'Payments' },
        CORRELATION_ID,
      );

      expect(result).toBe(team);
      expect(databaseService.withTransaction).toHaveBeenCalledTimes(1);
      expect(teamsRepository.create).toHaveBeenCalledWith(
        { workspaceId: WORKSPACE, code: 'PAY', name: 'Payments', description: null },
        FAKE_SESSION,
      );
      expect(membershipsRepository.addMember).toHaveBeenCalledWith(
        WORKSPACE,
        TEAM_ID,
        REQUESTER,
        'OWNER',
        FAKE_SESSION,
      );
    });

    it('enqueues exactly one team.created outbox fact with the committed aggregate version', async () => {
      const team = {
        _id: { toHexString: () => TEAM_ID },
        code: 'PAY',
        name: 'Payments',
        workspaceId: WORKSPACE,
        version: 1,
      };
      teamsRepository.create.mockResolvedValue(team);

      await service.createTeam(WORKSPACE, REQUESTER, { code: 'PAY', name: 'Payments' }, CORRELATION_ID);

      expect(outboxService.enqueue).toHaveBeenCalledTimes(1);
      expect(outboxService.enqueue).toHaveBeenCalledWith(FAKE_SESSION, {
        workspaceId: WORKSPACE,
        eventType: 'team.created',
        aggregateType: 'Team',
        aggregateId: TEAM_ID,
        aggregateVersion: 1,
        correlationId: CORRELATION_ID,
        causationId: null,
        actorId: REQUESTER,
        payload: { code: 'PAY', name: 'Payments' },
      });
    });

    it('propagates a duplicate-code conflict from the repository and creates no outbox event', async () => {
      teamsRepository.create.mockRejectedValue(new ConflictException('dup'));

      await expect(
        service.createTeam(WORKSPACE, REQUESTER, { code: 'PAY', name: 'Payments' }, CORRELATION_ID),
      ).rejects.toThrow(ConflictException);
      expect(membershipsRepository.addMember).not.toHaveBeenCalled();
      expect(outboxService.enqueue).not.toHaveBeenCalled();
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
        service.addMember(WORKSPACE, TEAM_ID, REQUESTER, { userId: 'u2', role: 'MEMBER' }, CORRELATION_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(outboxService.enqueue).not.toHaveBeenCalled();
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
    const team = { _id: TEAM_ID, workspaceId: WORKSPACE, archivedAt: null, version: 3 };

    beforeEach(() => {
      teamsRepository.findById.mockResolvedValue(team);
      membershipsRepository.findActive.mockResolvedValue({ role: 'OWNER' });
    });

    it('validates the target user belongs to the same workspace before adding, and never opens a transaction', async () => {
      usersRepository.assertBelongsToWorkspace.mockRejectedValue(new Error('cross-workspace'));

      await expect(
        service.addMember(
          WORKSPACE,
          TEAM_ID,
          REQUESTER,
          { userId: 'other-ws-user', role: 'MEMBER' },
          CORRELATION_ID,
        ),
      ).rejects.toThrow();
      expect(membershipsRepository.addMember).not.toHaveBeenCalled();
      expect(databaseService.withTransaction).not.toHaveBeenCalled();
      expect(outboxService.enqueue).not.toHaveBeenCalled();
    });

    it('adds the member and enqueues exactly one team.member_added fact once validation passes', async () => {
      usersRepository.assertBelongsToWorkspace.mockResolvedValue(undefined);
      const membership = { teamId: TEAM_ID, userId: 'u2', role: 'MEMBER' };
      membershipsRepository.addMember.mockResolvedValue(membership);

      const result = await service.addMember(
        WORKSPACE,
        TEAM_ID,
        REQUESTER,
        { userId: 'u2', role: 'MEMBER' },
        CORRELATION_ID,
      );

      expect(result).toBe(membership);
      expect(outboxService.enqueue).toHaveBeenCalledTimes(1);
      expect(outboxService.enqueue).toHaveBeenCalledWith(FAKE_SESSION, {
        workspaceId: WORKSPACE,
        eventType: 'team.member_added',
        aggregateType: 'Team',
        aggregateId: TEAM_ID,
        aggregateVersion: 3,
        correlationId: CORRELATION_ID,
        causationId: null,
        actorId: REQUESTER,
        payload: { userId: 'u2', role: 'MEMBER' },
      });
    });

    it('creates no outbox event when the membership insert itself fails (e.g. already an active member)', async () => {
      usersRepository.assertBelongsToWorkspace.mockResolvedValue(undefined);
      membershipsRepository.addMember.mockRejectedValue(new ConflictException('already a member'));

      await expect(
        service.addMember(WORKSPACE, TEAM_ID, REQUESTER, { userId: 'u2', role: 'MEMBER' }, CORRELATION_ID),
      ).rejects.toThrow(ConflictException);
      expect(outboxService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('getTeamOrThrow', () => {
    it('throws NotFoundException when the repository finds nothing - e.g. a real team id scoped to a different workspace', async () => {
      teamsRepository.findById.mockResolvedValue(null);

      await expect(service.getTeamOrThrow(WORKSPACE, TEAM_ID)).rejects.toThrow(NotFoundException);
      expect(teamsRepository.findById).toHaveBeenCalledWith(WORKSPACE, TEAM_ID);
    });

    it('returns the team when the repository resolves it', async () => {
      const team = { _id: TEAM_ID, workspaceId: WORKSPACE };
      teamsRepository.findById.mockResolvedValue(team);

      await expect(service.getTeamOrThrow(WORKSPACE, TEAM_ID)).resolves.toBe(team);
    });
  });
});

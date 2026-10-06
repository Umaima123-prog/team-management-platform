import { BadRequestException } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { BoardsService } from '../boards/boards.service';
import { ProjectsService } from '../projects/projects.service';
import { MembershipsRepository } from '../teams/memberships.repository';
import { UsersRepository } from '../identity/users.repository';
import { CountersRepository } from './counters.repository';
import { RANK_GAP } from './rank.util';
import { WorkItemsRepository } from './work-items.repository';
import { WorkItemsService } from './work-items.service';

const WORKSPACE = 'ws-1';
const PROJECT_ID = 'proj-1';
const TEAM_ID = 'team-1';
const REQUESTER = 'user-1';

function makeBoard() {
  return {
    _id: { toHexString: () => 'board-1' },
    columns: [
      { id: 'col-backlog', name: 'Backlog', order: 0, wipLimit: null },
      { id: 'col-todo', name: 'To Do', order: 1, wipLimit: null },
      { id: 'col-done', name: 'Done', order: 2, wipLimit: null },
    ],
  };
}

describe('WorkItemsService', () => {
  let workItemsRepository: {
    findById: jest.Mock;
    create: jest.Mock;
    updateFields: jest.Mock;
    assign: jest.Mock;
    move: jest.Mock;
    archive: jest.Mock;
    maxRankInColumn: jest.Mock;
    listColumnOrdered: jest.Mock;
    rebalanceColumn: jest.Mock;
    listByProject: jest.Mock;
  };
  let countersRepository: { getNextSequence: jest.Mock };
  let projectsService: { getProjectOrThrow: jest.Mock };
  let boardsService: { getByProjectId: jest.Mock; getByIdOrThrow: jest.Mock };
  let membershipsRepository: { isActiveMember: jest.Mock };
  let usersRepository: { assertBelongsToWorkspace: jest.Mock };
  let service: WorkItemsService;

  beforeEach(() => {
    workItemsRepository = {
      findById: jest.fn(),
      create: jest.fn(),
      updateFields: jest.fn(),
      assign: jest.fn(),
      move: jest.fn(),
      archive: jest.fn(),
      maxRankInColumn: jest.fn(),
      listColumnOrdered: jest.fn(),
      rebalanceColumn: jest.fn(),
      listByProject: jest.fn(),
    };
    countersRepository = { getNextSequence: jest.fn() };
    projectsService = { getProjectOrThrow: jest.fn() };
    boardsService = { getByProjectId: jest.fn(), getByIdOrThrow: jest.fn() };
    membershipsRepository = { isActiveMember: jest.fn() };
    usersRepository = { assertBelongsToWorkspace: jest.fn().mockResolvedValue(undefined) };

    service = new WorkItemsService(
      workItemsRepository as unknown as WorkItemsRepository,
      countersRepository as unknown as CountersRepository,
      projectsService as unknown as ProjectsService,
      boardsService as unknown as BoardsService,
      membershipsRepository as unknown as MembershipsRepository,
      usersRepository as unknown as UsersRepository,
    );
  });

  describe('createWorkItem', () => {
    const dto = { type: 'TASK', priority: 'MEDIUM', title: 'Do the thing' };

    beforeEach(() => {
      projectsService.getProjectOrThrow.mockResolvedValue({
        archivedAt: null,
        projectKey: 'PAY',
        teamId: TEAM_ID,
      });
      boardsService.getByProjectId.mockResolvedValue(makeBoard());
      workItemsRepository.maxRankInColumn.mockResolvedValue(null);
      countersRepository.getNextSequence.mockResolvedValue(1);
    });

    it('defaults to the first column (lowest order) when none is specified', async () => {
      await service.createWorkItem(WORKSPACE, PROJECT_ID, REQUESTER, dto as never);

      const created = (workItemsRepository.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(created.columnId).toBe('col-backlog');
    });

    it('formats the issueKey from the project key and an atomically-issued sequence', async () => {
      countersRepository.getNextSequence.mockResolvedValue(104);

      await service.createWorkItem(WORKSPACE, PROJECT_ID, REQUESTER, dto as never);

      const created = (workItemsRepository.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(created.issueKey).toBe('PAY-104');
    });

    it('appends a new rank after the current max in the target column', async () => {
      workItemsRepository.maxRankInColumn.mockResolvedValue(1024);

      await service.createWorkItem(WORKSPACE, PROJECT_ID, REQUESTER, dto as never);

      const created = (workItemsRepository.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(created.rank).toBe(1024 + RANK_GAP);
    });

    it('defaults the reporter to the requester when not explicitly given', async () => {
      await service.createWorkItem(WORKSPACE, PROJECT_ID, REQUESTER, dto as never);

      const created = (workItemsRepository.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(created.reporterId).toBe(REQUESTER);
      expect(usersRepository.assertBelongsToWorkspace).toHaveBeenCalledWith(
        WORKSPACE,
        REQUESTER,
        'reporterId',
      );
    });

    it('rejects an explicit columnId that does not exist on the board', async () => {
      await expect(
        service.createWorkItem(WORKSPACE, PROJECT_ID, REQUESTER, { ...dto, columnId: 'nope' } as never),
      ).rejects.toThrow(BadRequestException);
      expect(workItemsRepository.create).not.toHaveBeenCalled();
    });

    it('rejects creation on an archived project', async () => {
      projectsService.getProjectOrThrow.mockResolvedValue({ archivedAt: new Date() });

      await expect(service.createWorkItem(WORKSPACE, PROJECT_ID, REQUESTER, dto as never)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("rejects an assignee who is not a member of the project's owning team", async () => {
      membershipsRepository.isActiveMember.mockResolvedValue(false);

      await expect(
        service.createWorkItem(WORKSPACE, PROJECT_ID, REQUESTER, {
          ...dto,
          assigneeId: 'not-a-member',
        } as never),
      ).rejects.toThrow(BadRequestException);
      expect(workItemsRepository.create).not.toHaveBeenCalled();
    });

    it('accepts an assignee who is an active member of the owning team', async () => {
      membershipsRepository.isActiveMember.mockResolvedValue(true);

      await service.createWorkItem(WORKSPACE, PROJECT_ID, REQUESTER, {
        ...dto,
        assigneeId: 'member-1',
      } as never);

      const created = (workItemsRepository.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(created.assigneeId).toBe('member-1');
    });
  });

  describe('assignWorkItem', () => {
    beforeEach(() => {
      workItemsRepository.findById.mockResolvedValue({ projectId: PROJECT_ID });
      projectsService.getProjectOrThrow.mockResolvedValue({ teamId: TEAM_ID });
    });

    it('rejects assigning to a non-member of the owning team', async () => {
      membershipsRepository.isActiveMember.mockResolvedValue(false);

      await expect(
        service.assignWorkItem(WORKSPACE, 'item-1', { expectedVersion: 1, assigneeId: 'x' }),
      ).rejects.toThrow(BadRequestException);
      expect(workItemsRepository.assign).not.toHaveBeenCalled();
    });

    it('allows unassigning (null) without any membership check', async () => {
      await service.assignWorkItem(WORKSPACE, 'item-1', {
        expectedVersion: 1,
        assigneeId: null,
      });

      expect(membershipsRepository.isActiveMember).not.toHaveBeenCalled();
      expect(workItemsRepository.assign).toHaveBeenCalledWith(WORKSPACE, 'item-1', 1, null);
    });
  });

  describe('moveWorkItem', () => {
    const itemId = new ObjectId().toHexString();

    beforeEach(() => {
      workItemsRepository.findById.mockResolvedValue({ boardId: 'board-1' });
      boardsService.getByIdOrThrow.mockResolvedValue(makeBoard());
    });

    it('rejects a targetColumnId not present on the board', async () => {
      await expect(
        service.moveWorkItem(WORKSPACE, itemId, {
          expectedVersion: 1,
          targetColumnId: 'nope',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(workItemsRepository.move).not.toHaveBeenCalled();
    });

    it('rejects a beforeItemId that does not resolve to a real item', async () => {
      workItemsRepository.findById
        .mockResolvedValueOnce({ boardId: 'board-1' }) // the item being moved
        .mockResolvedValueOnce(null); // the neighbor lookup

      await expect(
        service.moveWorkItem(WORKSPACE, itemId, {
          expectedVersion: 1,
          targetColumnId: 'col-todo',
          beforeItemId: 'missing',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('moves to the end of the column when no neighbors are given', async () => {
      await service.moveWorkItem(WORKSPACE, itemId, {
        expectedVersion: 1,
        targetColumnId: 'col-todo',
      });

      expect(workItemsRepository.move).toHaveBeenCalledWith(WORKSPACE, itemId, 1, 'col-todo', RANK_GAP);
    });

    it('computes the midpoint rank between two given neighbors', async () => {
      const beforeId = new ObjectId().toHexString();
      const afterId = new ObjectId().toHexString();
      workItemsRepository.findById
        .mockResolvedValueOnce({ boardId: 'board-1' })
        .mockResolvedValueOnce({ rank: 1024 })
        .mockResolvedValueOnce({ rank: 2048 });

      await service.moveWorkItem(WORKSPACE, itemId, {
        expectedVersion: 1,
        targetColumnId: 'col-todo',
        beforeItemId: beforeId,
        afterItemId: afterId,
      });

      expect(workItemsRepository.move).toHaveBeenCalledWith(WORKSPACE, itemId, 1, 'col-todo', 1536);
    });

    it('rebalances the column when neighbor ranks have collapsed', async () => {
      const beforeId = new ObjectId().toHexString();
      const afterId = new ObjectId().toHexString();
      const before = 1;
      const after = before + Number.EPSILON;
      workItemsRepository.findById
        .mockResolvedValueOnce({ boardId: 'board-1' })
        .mockResolvedValueOnce({ rank: before })
        .mockResolvedValueOnce({ rank: after });
      workItemsRepository.listColumnOrdered.mockResolvedValue([
        { _id: { toHexString: () => beforeId } },
        { _id: { toHexString: () => afterId } },
      ]);

      await service.moveWorkItem(WORKSPACE, itemId, {
        expectedVersion: 1,
        targetColumnId: 'col-todo',
        beforeItemId: beforeId,
        afterItemId: afterId,
      });

      expect(workItemsRepository.rebalanceColumn).toHaveBeenCalled();
      // The moved item's own rank still goes through the normal
      // conditional-update move() call, now with a respaced value.
      expect(workItemsRepository.move).toHaveBeenCalledWith(
        WORKSPACE,
        itemId,
        1,
        'col-todo',
        expect.any(Number),
      );
    });
  });

  describe('listByProject', () => {
    beforeEach(() => {
      projectsService.getProjectOrThrow.mockResolvedValue({});
    });

    it('reports no nextCursor when results fit within the page size', async () => {
      workItemsRepository.listByProject.mockResolvedValue([{ _id: new ObjectId() }]);

      const { nextCursor } = await service.listByProject(WORKSPACE, PROJECT_ID, { limit: 10 });

      expect(nextCursor).toBeNull();
    });

    it('returns a nextCursor and trims the lookahead row when there are more results', async () => {
      const ids = [new ObjectId(), new ObjectId(), new ObjectId()];
      workItemsRepository.listByProject.mockResolvedValue(ids.map((id) => ({ _id: id })));

      const { items, nextCursor } = await service.listByProject(WORKSPACE, PROJECT_ID, {
        limit: 2,
      });

      expect(items).toHaveLength(2);
      expect(nextCursor).not.toBeNull();
    });
  });
});

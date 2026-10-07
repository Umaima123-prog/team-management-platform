import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClientSession, ObjectId } from 'mongodb';
import { BoardsService } from '../boards/boards.service';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../messaging/outbox/outbox.service';
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
const CORRELATION_ID = 'corr-1';
const FAKE_SESSION = {} as ClientSession;

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
  let databaseService: { withTransaction: jest.Mock };
  let outboxService: { enqueue: jest.Mock };
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
    databaseService = {
      withTransaction: jest.fn(async (fn: (session: ClientSession) => Promise<unknown>) => fn(FAKE_SESSION)),
    };
    outboxService = { enqueue: jest.fn().mockResolvedValue({ eventId: 'evt-1' }) };

    service = new WorkItemsService(
      workItemsRepository as unknown as WorkItemsRepository,
      countersRepository as unknown as CountersRepository,
      projectsService as unknown as ProjectsService,
      boardsService as unknown as BoardsService,
      membershipsRepository as unknown as MembershipsRepository,
      usersRepository as unknown as UsersRepository,
      databaseService as unknown as DatabaseService,
      outboxService as unknown as OutboxService,
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
      workItemsRepository.create.mockImplementation((item: Record<string, unknown>) =>
        Promise.resolve({ _id: { toHexString: () => 'item-1' }, version: 1, ...item }),
      );
    });

    it('defaults to the first column (lowest order) when none is specified', async () => {
      await service.createWorkItem(WORKSPACE, PROJECT_ID, REQUESTER, dto as never, CORRELATION_ID);

      const created = (workItemsRepository.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(created.columnId).toBe('col-backlog');
    });

    it('formats the issueKey from the project key and an atomically-issued sequence, inside the create transaction', async () => {
      countersRepository.getNextSequence.mockResolvedValue(104);

      await service.createWorkItem(WORKSPACE, PROJECT_ID, REQUESTER, dto as never, CORRELATION_ID);

      const created = (workItemsRepository.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(created.issueKey).toBe('PAY-104');
      expect(countersRepository.getNextSequence).toHaveBeenCalledWith(WORKSPACE, PROJECT_ID, FAKE_SESSION);
    });

    it('appends a new rank after the current max in the target column', async () => {
      workItemsRepository.maxRankInColumn.mockResolvedValue(1024);

      await service.createWorkItem(WORKSPACE, PROJECT_ID, REQUESTER, dto as never, CORRELATION_ID);

      const created = (workItemsRepository.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(created.rank).toBe(1024 + RANK_GAP);
    });

    it('defaults the reporter to the requester when not explicitly given', async () => {
      await service.createWorkItem(WORKSPACE, PROJECT_ID, REQUESTER, dto as never, CORRELATION_ID);

      const created = (workItemsRepository.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(created.reporterId).toBe(REQUESTER);
      expect(usersRepository.assertBelongsToWorkspace).toHaveBeenCalledWith(
        WORKSPACE,
        REQUESTER,
        'reporterId',
      );
    });

    it('rejects an explicit columnId that does not exist on the board, and opens no transaction', async () => {
      await expect(
        service.createWorkItem(
          WORKSPACE,
          PROJECT_ID,
          REQUESTER,
          { ...dto, columnId: 'nope' } as never,
          CORRELATION_ID,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(workItemsRepository.create).not.toHaveBeenCalled();
      expect(databaseService.withTransaction).not.toHaveBeenCalled();
      expect(outboxService.enqueue).not.toHaveBeenCalled();
    });

    it('rejects creation on an archived project', async () => {
      projectsService.getProjectOrThrow.mockResolvedValue({ archivedAt: new Date() });

      await expect(
        service.createWorkItem(WORKSPACE, PROJECT_ID, REQUESTER, dto as never, CORRELATION_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects an assignee who is not a member of the project's owning team", async () => {
      membershipsRepository.isActiveMember.mockResolvedValue(false);

      await expect(
        service.createWorkItem(
          WORKSPACE,
          PROJECT_ID,
          REQUESTER,
          { ...dto, assigneeId: 'not-a-member' } as never,
          CORRELATION_ID,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(workItemsRepository.create).not.toHaveBeenCalled();
      expect(outboxService.enqueue).not.toHaveBeenCalled();
    });

    it('accepts an assignee who is an active member of the owning team', async () => {
      membershipsRepository.isActiveMember.mockResolvedValue(true);

      await service.createWorkItem(
        WORKSPACE,
        PROJECT_ID,
        REQUESTER,
        { ...dto, assigneeId: 'member-1' } as never,
        CORRELATION_ID,
      );

      const created = (workItemsRepository.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(created.assigneeId).toBe('member-1');
    });

    it('enqueues exactly one workitem.created fact, inside the same transaction as the insert', async () => {
      await service.createWorkItem(WORKSPACE, PROJECT_ID, REQUESTER, dto as never, CORRELATION_ID);

      expect(databaseService.withTransaction).toHaveBeenCalledTimes(1);
      expect(outboxService.enqueue).toHaveBeenCalledTimes(1);
      expect(outboxService.enqueue).toHaveBeenCalledWith(
        FAKE_SESSION,
        expect.objectContaining({
          workspaceId: WORKSPACE,
          eventType: 'workitem.created',
          aggregateType: 'WorkItem',
          aggregateId: 'item-1',
          aggregateVersion: 1,
          correlationId: CORRELATION_ID,
          causationId: null,
          actorId: REQUESTER,
        }),
      );
    });

    it('creates no outbox event when the insert itself throws', async () => {
      workItemsRepository.create.mockRejectedValue(new Error('insert failed'));

      await expect(
        service.createWorkItem(WORKSPACE, PROJECT_ID, REQUESTER, dto as never, CORRELATION_ID),
      ).rejects.toThrow('insert failed');
      expect(outboxService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('assignWorkItem', () => {
    beforeEach(() => {
      workItemsRepository.findById.mockResolvedValue({ projectId: PROJECT_ID, assigneeId: 'old-user' });
      projectsService.getProjectOrThrow.mockResolvedValue({ teamId: TEAM_ID });
      workItemsRepository.assign.mockResolvedValue({ projectId: PROJECT_ID, version: 2, assigneeId: 'x' });
    });

    it('rejects assigning to a non-member of the owning team, and opens no transaction', async () => {
      membershipsRepository.isActiveMember.mockResolvedValue(false);

      await expect(
        service.assignWorkItem(
          WORKSPACE,
          'item-1',
          { expectedVersion: 1, assigneeId: 'x' },
          REQUESTER,
          CORRELATION_ID,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(workItemsRepository.assign).not.toHaveBeenCalled();
      expect(databaseService.withTransaction).not.toHaveBeenCalled();
    });

    it('allows unassigning (null) without any membership check', async () => {
      await service.assignWorkItem(
        WORKSPACE,
        'item-1',
        { expectedVersion: 1, assigneeId: null },
        REQUESTER,
        CORRELATION_ID,
      );

      expect(membershipsRepository.isActiveMember).not.toHaveBeenCalled();
      expect(workItemsRepository.assign).toHaveBeenCalledWith(WORKSPACE, 'item-1', 1, null, FAKE_SESSION);
    });

    it('enqueues workitem.assigned carrying the previous and new assignee as a delta', async () => {
      membershipsRepository.isActiveMember.mockResolvedValue(true);

      await service.assignWorkItem(
        WORKSPACE,
        'item-1',
        { expectedVersion: 1, assigneeId: 'x' },
        REQUESTER,
        CORRELATION_ID,
      );

      expect(outboxService.enqueue).toHaveBeenCalledWith(
        FAKE_SESSION,
        expect.objectContaining({
          eventType: 'workitem.assigned',
          aggregateId: 'item-1',
          aggregateVersion: 2,
          payload: { projectId: PROJECT_ID, previousAssigneeId: 'old-user', assigneeId: 'x' },
        }),
      );
    });
  });

  describe('moveWorkItem', () => {
    const itemId = new ObjectId().toHexString();

    beforeEach(() => {
      workItemsRepository.findById.mockResolvedValue({ boardId: 'board-1', projectId: PROJECT_ID, columnId: 'col-backlog' });
      boardsService.getByIdOrThrow.mockResolvedValue(makeBoard());
      workItemsRepository.move.mockResolvedValue({ projectId: PROJECT_ID, version: 2 });
    });

    it('rejects a targetColumnId not present on the board', async () => {
      await expect(
        service.moveWorkItem(
          WORKSPACE,
          itemId,
          { expectedVersion: 1, targetColumnId: 'nope' },
          REQUESTER,
          CORRELATION_ID,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(workItemsRepository.move).not.toHaveBeenCalled();
    });

    it('rejects a beforeItemId that does not resolve to a real item', async () => {
      workItemsRepository.findById
        .mockResolvedValueOnce({ boardId: 'board-1', projectId: PROJECT_ID, columnId: 'col-backlog' }) // the item being moved
        .mockResolvedValueOnce(null); // the neighbor lookup

      await expect(
        service.moveWorkItem(
          WORKSPACE,
          itemId,
          { expectedVersion: 1, targetColumnId: 'col-todo', beforeItemId: 'missing' },
          REQUESTER,
          CORRELATION_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('moves to the end of the column when no neighbors are given', async () => {
      await service.moveWorkItem(
        WORKSPACE,
        itemId,
        { expectedVersion: 1, targetColumnId: 'col-todo' },
        REQUESTER,
        CORRELATION_ID,
      );

      expect(workItemsRepository.move).toHaveBeenCalledWith(
        WORKSPACE,
        itemId,
        1,
        'col-todo',
        RANK_GAP,
        FAKE_SESSION,
      );
    });

    it('computes the midpoint rank between two given neighbors', async () => {
      const beforeId = new ObjectId().toHexString();
      const afterId = new ObjectId().toHexString();
      workItemsRepository.findById
        .mockResolvedValueOnce({ boardId: 'board-1', projectId: PROJECT_ID, columnId: 'col-backlog' })
        .mockResolvedValueOnce({ rank: 1024 })
        .mockResolvedValueOnce({ rank: 2048 });

      await service.moveWorkItem(
        WORKSPACE,
        itemId,
        { expectedVersion: 1, targetColumnId: 'col-todo', beforeItemId: beforeId, afterItemId: afterId },
        REQUESTER,
        CORRELATION_ID,
      );

      expect(workItemsRepository.move).toHaveBeenCalledWith(
        WORKSPACE,
        itemId,
        1,
        'col-todo',
        1536,
        FAKE_SESSION,
      );
    });

    it('rebalances the column when neighbor ranks have collapsed', async () => {
      const beforeId = new ObjectId().toHexString();
      const afterId = new ObjectId().toHexString();
      const before = 1;
      const after = before + Number.EPSILON;
      workItemsRepository.findById
        .mockResolvedValueOnce({ boardId: 'board-1', projectId: PROJECT_ID, columnId: 'col-backlog' })
        .mockResolvedValueOnce({ rank: before })
        .mockResolvedValueOnce({ rank: after });
      workItemsRepository.listColumnOrdered.mockResolvedValue([
        { _id: { toHexString: () => beforeId } },
        { _id: { toHexString: () => afterId } },
      ]);

      await service.moveWorkItem(
        WORKSPACE,
        itemId,
        { expectedVersion: 1, targetColumnId: 'col-todo', beforeItemId: beforeId, afterItemId: afterId },
        REQUESTER,
        CORRELATION_ID,
      );

      expect(workItemsRepository.rebalanceColumn).toHaveBeenCalled();
      // The moved item's own rank still goes through the normal
      // conditional-update move() call, now with a respaced value.
      expect(workItemsRepository.move).toHaveBeenCalledWith(
        WORKSPACE,
        itemId,
        1,
        'col-todo',
        expect.any(Number),
        FAKE_SESSION,
      );
    });

    it('enqueues workitem.moved with the from/to column and final rank', async () => {
      await service.moveWorkItem(
        WORKSPACE,
        itemId,
        { expectedVersion: 1, targetColumnId: 'col-todo' },
        REQUESTER,
        CORRELATION_ID,
      );

      expect(outboxService.enqueue).toHaveBeenCalledWith(
        FAKE_SESSION,
        expect.objectContaining({
          eventType: 'workitem.moved',
          aggregateId: itemId,
          aggregateVersion: 2,
          payload: { projectId: PROJECT_ID, fromColumnId: 'col-backlog', toColumnId: 'col-todo', rank: RANK_GAP },
        }),
      );
    });

    it('creates no outbox event when the conditional move update itself fails (stale version)', async () => {
      workItemsRepository.move.mockRejectedValue(new Error('conflict'));

      await expect(
        service.moveWorkItem(
          WORKSPACE,
          itemId,
          { expectedVersion: 1, targetColumnId: 'col-todo' },
          REQUESTER,
          CORRELATION_ID,
        ),
      ).rejects.toThrow('conflict');
      expect(outboxService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('updateWorkItem', () => {
    beforeEach(() => {
      workItemsRepository.findById.mockResolvedValue({ projectId: PROJECT_ID });
      workItemsRepository.updateFields.mockResolvedValue({ projectId: PROJECT_ID, version: 2 });
    });

    it('only sends the fields that were actually provided, and reports exactly those in changedFields', async () => {
      await service.updateWorkItem(
        WORKSPACE,
        'item-1',
        { expectedVersion: 1, priority: 'HIGH' } as never,
        REQUESTER,
        CORRELATION_ID,
      );

      expect(workItemsRepository.updateFields).toHaveBeenCalledWith(
        WORKSPACE,
        'item-1',
        1,
        { priority: 'HIGH' },
        FAKE_SESSION,
      );
      expect(outboxService.enqueue).toHaveBeenCalledWith(
        FAKE_SESSION,
        expect.objectContaining({
          eventType: 'workitem.updated',
          payload: { projectId: PROJECT_ID, changedFields: ['priority'], priority: 'HIGH' },
        }),
      );
    });

    it('never puts free-text field content (title/description) in the payload, only in changedFields', async () => {
      await service.updateWorkItem(
        WORKSPACE,
        'item-1',
        { expectedVersion: 1, title: 'Secret project codename' },
        REQUESTER,
        CORRELATION_ID,
      );

      const [, call] = outboxService.enqueue.mock.calls[0] as [unknown, { payload: Record<string, unknown> }];
      expect(call.payload.changedFields).toEqual(['title']);
      expect(JSON.stringify(call.payload)).not.toContain('Secret project codename');
    });
  });

  describe('archiveWorkItem', () => {
    it('enqueues workitem.archived carrying the column the item was archived from', async () => {
      workItemsRepository.findById.mockResolvedValue({ projectId: PROJECT_ID, columnId: 'col-done' });
      workItemsRepository.archive.mockResolvedValue({ projectId: PROJECT_ID, version: 3 });

      await service.archiveWorkItem(WORKSPACE, 'item-1', 2, REQUESTER, CORRELATION_ID);

      expect(workItemsRepository.archive).toHaveBeenCalledWith(WORKSPACE, 'item-1', 2, FAKE_SESSION);
      expect(outboxService.enqueue).toHaveBeenCalledWith(
        FAKE_SESSION,
        expect.objectContaining({
          eventType: 'workitem.archived',
          aggregateId: 'item-1',
          aggregateVersion: 3,
          payload: { projectId: PROJECT_ID, previousColumnId: 'col-done' },
        }),
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

  describe('getItemOrThrow', () => {
    it('throws NotFoundException when the repository finds nothing - e.g. a real item id scoped to a different workspace', async () => {
      workItemsRepository.findById.mockResolvedValue(null);

      await expect(service.getItemOrThrow(WORKSPACE, 'item-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(workItemsRepository.findById).toHaveBeenCalledWith(WORKSPACE, 'item-1');
    });

    it('returns the item when the repository resolves it', async () => {
      const item = { _id: 'item-1', workspaceId: WORKSPACE };
      workItemsRepository.findById.mockResolvedValue(item);

      await expect(service.getItemOrThrow(WORKSPACE, 'item-1')).resolves.toBe(item);
    });
  });
});

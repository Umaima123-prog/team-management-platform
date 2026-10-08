import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClientSession } from 'mongodb';
import { RolesGuard } from '../auth/roles.guard';
import { BoardsService } from '../boards/boards.service';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../messaging/outbox/outbox.service';
import { ProjectsService } from '../projects/projects.service';
import { MembershipsRepository } from '../teams/memberships.repository';
import { UsersRepository } from '../identity/users.repository';
import { UserRole } from '../identity/user.schema';
import { CountersRepository } from './counters.repository';
import { WorkItemsController } from './work-items.controller';
import { WorkItemsRepository } from './work-items.repository';
import { WorkItemsService } from './work-items.service';

const WORKSPACE = 'ws-1';
const PROJECT_ID = 'proj-1';
const CORRELATION_ID = 'corr-1';
const ADMIN: UserRole = 'ADMIN';
const EMPLOYEE: UserRole = 'EMPLOYEE';
const ASSIGNEE = 'user-assignee';
const OTHER_EMPLOYEE = 'user-other-employee';
const FAKE_SESSION = {} as ClientSession;

/** A minimal fake ExecutionContext - just enough for RolesGuard to
 * read the real `@Roles()` metadata off the real controller method
 * (via a real Reflector, not a reimplementation of its logic) and the
 * caller's role off `request.context`, exactly as it runs in
 * production between RequestContextGuard and the controller. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function contextFor(handler: (...args: any[]) => unknown, role: UserRole): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => WorkItemsController,
    switchToHttp: () => ({ getRequest: () => ({ context: { role } }) }),
  } as unknown as ExecutionContext;
}

/**
 * End-to-end proof (within this service) of the work-item
 * authorization rule added after the initial Phase 9 RBAC pass:
 *
 *   - create/assign/archive: ADMIN only (RolesGuard + @Roles('ADMIN'))
 *   - update/move: any authenticated role may attempt it (no
 *     @Roles() restriction - RolesGuard lets it through), but
 *     EMPLOYEE may only act on a work item currently assigned to
 *     them; WorkItemsService itself enforces that (see
 *     assertCanMutateAssignedItem) since it requires the loaded
 *     item, not just the route. ADMIN is exempt from the ownership
 *     check entirely.
 *
 * This file exercises BOTH layers together - the real RolesGuard
 * against the real controller's metadata, and the real
 * WorkItemsService against a mocked repository - rather than
 * asserting on either one's internals in isolation.
 */
describe('WorkItems authorization: create/assign/archive are ADMIN-only; update/move require ownership', () => {
  const rolesGuard = new RolesGuard(new Reflector());

  describe('RolesGuard: create/assign/archive', () => {
    it.each([
      ['create', WorkItemsController.prototype.create],
      ['assign', WorkItemsController.prototype.assign],
      ['archive', WorkItemsController.prototype.archive],
    ])('rejects EMPLOYEE with 403 for %s', (_name, handler) => {
      expect(() => rolesGuard.canActivate(contextFor(handler, EMPLOYEE))).toThrow(ForbiddenException);
    });

    it.each([
      ['create', WorkItemsController.prototype.create],
      ['assign', WorkItemsController.prototype.assign],
      ['archive', WorkItemsController.prototype.archive],
    ])('allows ADMIN for %s', (_name, handler) => {
      expect(rolesGuard.canActivate(contextFor(handler, ADMIN))).toBe(true);
    });
  });

  describe('RolesGuard: update/move have no role restriction - reachable by any authenticated role', () => {
    it.each([
      ['update', WorkItemsController.prototype.update],
      ['move', WorkItemsController.prototype.move],
    ])('lets EMPLOYEE reach %s (ownership is checked afterward, by the service)', (_name, handler) => {
      expect(rolesGuard.canActivate(contextFor(handler, EMPLOYEE))).toBe(true);
    });
  });

  describe('WorkItemsService: ownership enforcement on update/move', () => {
    let workItemsRepository: {
      findById: jest.Mock;
      updateFields: jest.Mock;
      move: jest.Mock;
      listColumnOrdered: jest.Mock;
    };
    let boardsService: { getByIdOrThrow: jest.Mock };
    let databaseService: { withTransaction: jest.Mock };
    let outboxService: { enqueue: jest.Mock };
    let service: WorkItemsService;

    function makeBoard() {
      return {
        _id: { toHexString: () => 'board-1' },
        columns: [{ id: 'col-todo', name: 'To Do', order: 0, wipLimit: null }],
      };
    }

    beforeEach(() => {
      workItemsRepository = {
        findById: jest.fn(),
        updateFields: jest.fn().mockResolvedValue({ projectId: PROJECT_ID, version: 2 }),
        move: jest.fn().mockResolvedValue({ projectId: PROJECT_ID, version: 2 }),
        listColumnOrdered: jest.fn(),
      };
      boardsService = { getByIdOrThrow: jest.fn().mockResolvedValue(makeBoard()) };
      databaseService = {
        withTransaction: jest.fn(async (fn: (session: ClientSession) => Promise<unknown>) => fn(FAKE_SESSION)),
      };
      outboxService = { enqueue: jest.fn().mockResolvedValue({ eventId: 'evt-1' }) };

      service = new WorkItemsService(
        workItemsRepository as unknown as WorkItemsRepository,
        {} as unknown as CountersRepository,
        {} as unknown as ProjectsService,
        boardsService as unknown as BoardsService,
        {} as unknown as MembershipsRepository,
        {} as unknown as UsersRepository,
        databaseService as unknown as DatabaseService,
        outboxService as unknown as OutboxService,
      );
    });

    it('1. EMPLOYEE can update a work item assigned to them', async () => {
      workItemsRepository.findById.mockResolvedValue({ projectId: PROJECT_ID, assigneeId: ASSIGNEE });

      await expect(
        service.updateWorkItem(
          WORKSPACE,
          'item-1',
          { expectedVersion: 1, priority: 'HIGH' } as never,
          ASSIGNEE,
          EMPLOYEE,
          CORRELATION_ID,
        ),
      ).resolves.toBeDefined();
      expect(workItemsRepository.updateFields).toHaveBeenCalled();
    });

    it("1. EMPLOYEE can move a work item assigned to them", async () => {
      workItemsRepository.findById.mockResolvedValue({
        boardId: 'board-1',
        projectId: PROJECT_ID,
        columnId: 'col-todo',
        assigneeId: ASSIGNEE,
      });

      await expect(
        service.moveWorkItem(
          WORKSPACE,
          'item-1',
          { expectedVersion: 1, targetColumnId: 'col-todo' },
          ASSIGNEE,
          EMPLOYEE,
          CORRELATION_ID,
        ),
      ).resolves.toBeDefined();
      expect(workItemsRepository.move).toHaveBeenCalled();
    });

    it("2. EMPLOYEE gets 403 updating another employee's assigned work item", async () => {
      workItemsRepository.findById.mockResolvedValue({ projectId: PROJECT_ID, assigneeId: OTHER_EMPLOYEE });

      await expect(
        service.updateWorkItem(
          WORKSPACE,
          'item-1',
          { expectedVersion: 1, priority: 'HIGH' } as never,
          ASSIGNEE,
          EMPLOYEE,
          CORRELATION_ID,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(workItemsRepository.updateFields).not.toHaveBeenCalled();
      expect(outboxService.enqueue).not.toHaveBeenCalled();
    });

    it("2. EMPLOYEE gets 403 moving another employee's assigned work item", async () => {
      workItemsRepository.findById.mockResolvedValue({
        boardId: 'board-1',
        projectId: PROJECT_ID,
        columnId: 'col-todo',
        assigneeId: OTHER_EMPLOYEE,
      });

      await expect(
        service.moveWorkItem(
          WORKSPACE,
          'item-1',
          { expectedVersion: 1, targetColumnId: 'col-todo' },
          ASSIGNEE,
          EMPLOYEE,
          CORRELATION_ID,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(workItemsRepository.move).not.toHaveBeenCalled();
      expect(outboxService.enqueue).not.toHaveBeenCalled();
    });

    it('2. EMPLOYEE gets 403 updating/moving an unassigned work item (not theirs either)', async () => {
      workItemsRepository.findById.mockResolvedValue({ projectId: PROJECT_ID, assigneeId: null });

      await expect(
        service.updateWorkItem(
          WORKSPACE,
          'item-1',
          { expectedVersion: 1, priority: 'HIGH' } as never,
          ASSIGNEE,
          EMPLOYEE,
          CORRELATION_ID,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('4. ADMIN can update any work item regardless of assignee', async () => {
      workItemsRepository.findById.mockResolvedValue({ projectId: PROJECT_ID, assigneeId: OTHER_EMPLOYEE });

      await expect(
        service.updateWorkItem(
          WORKSPACE,
          'item-1',
          { expectedVersion: 1, priority: 'HIGH' } as never,
          'admin-1',
          ADMIN,
          CORRELATION_ID,
        ),
      ).resolves.toBeDefined();
      expect(workItemsRepository.updateFields).toHaveBeenCalled();
    });

    it('4. ADMIN can move any work item regardless of assignee', async () => {
      workItemsRepository.findById.mockResolvedValue({
        boardId: 'board-1',
        projectId: PROJECT_ID,
        columnId: 'col-todo',
        assigneeId: OTHER_EMPLOYEE,
      });

      await expect(
        service.moveWorkItem(
          WORKSPACE,
          'item-1',
          { expectedVersion: 1, targetColumnId: 'col-todo' },
          'admin-1',
          ADMIN,
          CORRELATION_ID,
        ),
      ).resolves.toBeDefined();
      expect(workItemsRepository.move).toHaveBeenCalled();
    });
  });
});

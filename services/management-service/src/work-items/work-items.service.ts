import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { clampLimit, decodeCursor, encodeCursor } from '../common/pagination/cursor.util';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../messaging/outbox/outbox.service';
import { BoardDocument } from '../boards/board.schema';
import { BoardsService } from '../boards/boards.service';
import { ProjectsService } from '../projects/projects.service';
import { MembershipsRepository } from '../teams/memberships.repository';
import { UsersRepository } from '../identity/users.repository';
import { AssignWorkItemDto } from './dto/assign-work-item.dto';
import { CreateWorkItemDto } from './dto/create-work-item.dto';
import { ListWorkItemsQueryDto } from './dto/list-work-items-query.dto';
import { MoveWorkItemDto } from './dto/move-work-item.dto';
import { UpdateWorkItemDto } from './dto/update-work-item.dto';
import { formatIssueKey } from './issue-key.util';
import { appendRank, needsRebalance, rankBetween, rebalancedRanks } from './rank.util';
import { CountersRepository } from './counters.repository';
import { WorkItemsRepository } from './work-items.repository';

@Injectable()
export class WorkItemsService {
  constructor(
    private readonly workItemsRepository: WorkItemsRepository,
    private readonly countersRepository: CountersRepository,
    private readonly projectsService: ProjectsService,
    private readonly boardsService: BoardsService,
    private readonly membershipsRepository: MembershipsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly databaseService: DatabaseService,
    private readonly outboxService: OutboxService,
  ) {}

  async getItemOrThrow(workspaceId: string, itemId: string) {
    const item = await this.workItemsRepository.findById(workspaceId, itemId);
    if (!item) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Work item not found.' });
    }
    return item;
  }

  private resolveColumn(board: BoardDocument, columnId: string | undefined) {
    if (columnId) {
      const column = board.columns.find((c) => c.id === columnId);
      if (!column) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'columnId must reference a column on this project\'s board.',
        });
      }
      return column;
    }
    const [first] = [...board.columns].sort((a, b) => a.order - b.order);
    return first;
  }

  /** "assignee must be a member of the project's owning team" */
  private async assertAssigneeEligible(
    workspaceId: string,
    teamId: string,
    assigneeId: string | null,
  ): Promise<void> {
    if (assigneeId === null) return;
    await this.usersRepository.assertBelongsToWorkspace(workspaceId, assigneeId, 'assigneeId');
    const isMember = await this.membershipsRepository.isActiveMember(workspaceId, teamId, assigneeId);
    if (!isMember) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: "assigneeId must be an active member of this project's owning team.",
      });
    }
  }

  async createWorkItem(
    workspaceId: string,
    projectId: string,
    requesterId: string,
    dto: CreateWorkItemDto,
    correlationId: string,
  ) {
    const project = await this.projectsService.getProjectOrThrow(workspaceId, projectId);
    if (project.archivedAt) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Cannot create work items on an archived project.',
      });
    }
    const board = await this.boardsService.getByProjectId(workspaceId, projectId);
    const column = this.resolveColumn(board, dto.columnId);

    const reporterId = dto.reporterId ?? requesterId;
    await this.usersRepository.assertBelongsToWorkspace(workspaceId, reporterId, 'reporterId');

    const assigneeId = dto.assigneeId ?? null;
    await this.assertAssigneeEligible(workspaceId, project.teamId, assigneeId);

    const maxRank = await this.workItemsRepository.maxRankInColumn(
      workspaceId,
      board._id.toHexString(),
      column.id,
    );

    return this.databaseService.withTransaction(async (session) => {
      const seq = await this.countersRepository.getNextSequence(workspaceId, projectId, session);

      const item = await this.workItemsRepository.create(
        {
          workspaceId,
          issueKey: formatIssueKey(project.projectKey, seq),
          projectId,
          boardId: board._id.toHexString(),
          columnId: column.id,
          rank: appendRank(maxRank),
          type: dto.type,
          priority: dto.priority,
          title: dto.title,
          description: dto.description ?? null,
          reporterId,
          assigneeId,
          labels: dto.labels ?? [],
          dueDate: dto.dueDate ?? null,
          acceptanceNotes: dto.acceptanceNotes ?? null,
        },
        session,
      );

      await this.outboxService.enqueue(session, {
        workspaceId,
        eventType: 'workitem.created',
        aggregateType: 'WorkItem',
        aggregateId: item._id.toHexString(),
        aggregateVersion: item.version,
        correlationId,
        causationId: null,
        actorId: requesterId,
        payload: {
          issueKey: item.issueKey,
          projectId,
          boardId: item.boardId,
          columnId: item.columnId,
          type: item.type,
          priority: item.priority,
          assigneeId: item.assigneeId,
          reporterId: item.reporterId,
          labels: item.labels,
        },
      });

      return item;
    });
  }

  async listByProject(workspaceId: string, projectId: string, query: ListWorkItemsQueryDto) {
    await this.projectsService.getProjectOrThrow(workspaceId, projectId);

    const limit = clampLimit(query.limit);
    const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

    const page = await this.workItemsRepository.listByProject(
      workspaceId,
      projectId,
      {
        assigneeId: query.assigneeId,
        priority: query.priority,
        type: query.type,
        label: query.label,
        q: query.q,
        includeArchived: query.includeArchived === 'true',
      },
      cursorId,
      limit + 1,
    );

    const hasMore = page.length > limit;
    const items = hasMore ? page.slice(0, limit) : page;
    const nextCursor = hasMore ? encodeCursor(items[items.length - 1]._id) : null;
    return { items, nextCursor };
  }

  async updateWorkItem(
    workspaceId: string,
    itemId: string,
    dto: UpdateWorkItemDto,
    actorId: string,
    correlationId: string,
  ) {
    await this.getItemOrThrow(workspaceId, itemId);
    const patch: Partial<{
      title: string;
      description: string | null;
      type: UpdateWorkItemDto['type'];
      priority: UpdateWorkItemDto['priority'];
      labels: string[];
      dueDate: Date | null;
      acceptanceNotes: string | null;
    }> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.priority !== undefined) patch.priority = dto.priority;
    if (dto.labels !== undefined) patch.labels = dto.labels;
    if (dto.dueDate !== undefined) patch.dueDate = dto.dueDate;
    if (dto.acceptanceNotes !== undefined) patch.acceptanceNotes = dto.acceptanceNotes;

    return this.databaseService.withTransaction(async (session) => {
      const updated = await this.workItemsRepository.updateFields(
        workspaceId,
        itemId,
        dto.expectedVersion,
        patch,
        session,
      );

      // Projection-relevant fields are carried by value (catalog:
      // "Update priority, labels, due date, or status projection");
      // free-text fields (title/description/acceptanceNotes) are only
      // named in changedFields, never their content - see
      // docs/ARCHITECTURE.md "Events are facts ... without exposing
      // secrets" / no unnecessary payload bulk.
      const changedFields = Object.keys(patch);
      await this.outboxService.enqueue(session, {
        workspaceId,
        eventType: 'workitem.updated',
        aggregateType: 'WorkItem',
        aggregateId: itemId,
        aggregateVersion: updated.version,
        correlationId,
        causationId: null,
        actorId,
        payload: {
          projectId: updated.projectId,
          changedFields,
          ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
          ...(dto.labels !== undefined ? { labels: dto.labels } : {}),
          ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate?.toISOString() ?? null } : {}),
        },
      });

      return updated;
    });
  }

  async assignWorkItem(
    workspaceId: string,
    itemId: string,
    dto: AssignWorkItemDto,
    actorId: string,
    correlationId: string,
  ) {
    const item = await this.getItemOrThrow(workspaceId, itemId);
    const project = await this.projectsService.getProjectOrThrow(workspaceId, item.projectId);
    const assigneeId = dto.assigneeId ?? null;
    await this.assertAssigneeEligible(workspaceId, project.teamId, assigneeId);

    return this.databaseService.withTransaction(async (session) => {
      const updated = await this.workItemsRepository.assign(
        workspaceId,
        itemId,
        dto.expectedVersion,
        assigneeId,
        session,
      );

      await this.outboxService.enqueue(session, {
        workspaceId,
        eventType: 'workitem.assigned',
        aggregateType: 'WorkItem',
        aggregateId: itemId,
        aggregateVersion: updated.version,
        correlationId,
        causationId: null,
        actorId,
        // "Move workload between assignees idempotently" (catalog) -
        // the Python projection applies this as a delta from
        // previousAssigneeId to assigneeId, not an absolute count.
        payload: { projectId: updated.projectId, previousAssigneeId: item.assigneeId, assigneeId },
      });

      return updated;
    });
  }

  async moveWorkItem(
    workspaceId: string,
    itemId: string,
    dto: MoveWorkItemDto,
    actorId: string,
    correlationId: string,
  ) {
    const item = await this.getItemOrThrow(workspaceId, itemId);
    const board = await this.boardsService.getByIdOrThrow(workspaceId, item.boardId);
    const targetColumn = board.columns.find((c) => c.id === dto.targetColumnId);
    if (!targetColumn) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: "targetColumnId must reference a column on this item's board.",
      });
    }

    const [beforeItem, afterItem] = await Promise.all([
      dto.beforeItemId ? this.requireNeighbor(workspaceId, dto.beforeItemId) : null,
      dto.afterItemId ? this.requireNeighbor(workspaceId, dto.afterItemId) : null,
    ]);
    const beforeRank = beforeItem?.rank ?? null;
    const afterRank = afterItem?.rank ?? null;

    let finalRank = rankBetween(beforeRank, afterRank);

    if (needsRebalance(beforeRank, afterRank)) {
      finalRank = await this.rebalanceAndComputeRank(
        workspaceId,
        board._id.toHexString(),
        targetColumn.id,
        itemId,
        dto.beforeItemId ?? null,
      );
    }

    const fromColumnId = item.columnId;
    return this.databaseService.withTransaction(async (session) => {
      const updated = await this.workItemsRepository.move(
        workspaceId,
        itemId,
        dto.expectedVersion,
        targetColumn.id,
        finalRank,
        session,
      );

      await this.outboxService.enqueue(session, {
        workspaceId,
        eventType: 'workitem.moved',
        aggregateType: 'WorkItem',
        aggregateId: itemId,
        aggregateVersion: updated.version,
        correlationId,
        causationId: null,
        actorId,
        payload: {
          projectId: updated.projectId,
          fromColumnId,
          toColumnId: targetColumn.id,
          rank: finalRank,
        },
      });

      return updated;
    });
  }

  private async requireNeighbor(workspaceId: string, neighborItemId: string) {
    const neighbor = await this.workItemsRepository.findById(workspaceId, neighborItemId);
    if (!neighbor) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'beforeItemId/afterItemId must reference an existing work item.',
      });
    }
    return neighbor;
  }

  /** Re-spaces every item currently in the target column (minus the
   * item being moved), inserts the moved item at the requested
   * position, writes the respaced ranks for the OTHER items, and
   * returns the rank the moved item itself should get (written by the
   * caller's subsequent conditionalUpdate, so the move stays one
   * atomic optimistic-concurrency-checked write for the moved item).
   *
   * Deliberately runs OUTSIDE the move's own transaction: it only
   * touches `rank` on documents other than the one being moved (not a
   * business fact anyone is notified about - no outbox event), and
   * keeping it out of the transaction keeps that transaction's
   * critical section short. If the subsequent conditional update on
   * the moved item itself then fails (e.g. a stale expectedVersion),
   * the rebalance already committed - this only ever widens the gaps
   * between existing ranks and is safe to have happened regardless
   * (see src/work-items/rank.util.ts for the rebalancing contract). */
  private async rebalanceAndComputeRank(
    workspaceId: string,
    boardId: string,
    columnId: string,
    movingItemId: string,
    beforeItemId: string | null,
  ): Promise<number> {
    const columnItems = await this.workItemsRepository.listColumnOrdered(workspaceId, boardId, columnId);
    const otherIds = columnItems.map((i) => i._id.toHexString()).filter((id) => id !== movingItemId);

    const insertAt = beforeItemId ? otherIds.indexOf(beforeItemId) + 1 : 0;
    const orderedWithMoved = [...otherIds];
    orderedWithMoved.splice(insertAt, 0, movingItemId);

    const ranks = rebalancedRanks(orderedWithMoved);
    const otherRanks = new Map(ranks);
    otherRanks.delete(movingItemId);
    await this.workItemsRepository.rebalanceColumn(workspaceId, boardId, columnId, otherRanks);

    return ranks.get(movingItemId) as number;
  }

  async archiveWorkItem(
    workspaceId: string,
    itemId: string,
    expectedVersion: number,
    actorId: string,
    correlationId: string,
  ) {
    const item = await this.getItemOrThrow(workspaceId, itemId);

    return this.databaseService.withTransaction(async (session) => {
      const updated = await this.workItemsRepository.archive(workspaceId, itemId, expectedVersion, session);

      await this.outboxService.enqueue(session, {
        workspaceId,
        eventType: 'workitem.archived',
        aggregateType: 'WorkItem',
        aggregateId: itemId,
        aggregateVersion: updated.version,
        correlationId,
        causationId: null,
        actorId,
        payload: { projectId: updated.projectId, previousColumnId: item.columnId },
      });

      return updated;
    });
  }
}

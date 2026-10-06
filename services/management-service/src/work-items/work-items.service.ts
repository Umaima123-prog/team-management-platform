import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { clampLimit, decodeCursor, encodeCursor } from '../common/pagination/cursor.util';
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

  async createWorkItem(workspaceId: string, projectId: string, requesterId: string, dto: CreateWorkItemDto) {
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
    const seq = await this.countersRepository.getNextSequence(workspaceId, projectId);

    return this.workItemsRepository.create({
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

  async updateWorkItem(workspaceId: string, itemId: string, dto: UpdateWorkItemDto) {
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

    return this.workItemsRepository.updateFields(workspaceId, itemId, dto.expectedVersion, patch);
  }

  async assignWorkItem(workspaceId: string, itemId: string, dto: AssignWorkItemDto) {
    const item = await this.getItemOrThrow(workspaceId, itemId);
    const project = await this.projectsService.getProjectOrThrow(workspaceId, item.projectId);
    const assigneeId = dto.assigneeId ?? null;
    await this.assertAssigneeEligible(workspaceId, project.teamId, assigneeId);
    return this.workItemsRepository.assign(workspaceId, itemId, dto.expectedVersion, assigneeId);
  }

  async moveWorkItem(workspaceId: string, itemId: string, dto: MoveWorkItemDto) {
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

    return this.workItemsRepository.move(workspaceId, itemId, dto.expectedVersion, targetColumn.id, finalRank);
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
   * atomic optimistic-concurrency-checked write for the moved item). */
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

  async archiveWorkItem(workspaceId: string, itemId: string, expectedVersion: number) {
    await this.getItemOrThrow(workspaceId, itemId);
    return this.workItemsRepository.archive(workspaceId, itemId, expectedVersion);
  }
}

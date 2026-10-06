import { Injectable } from '@nestjs/common';
import { Filter, ObjectId } from 'mongodb';
import { DatabaseService } from '../database/database.service';
import { WorkspaceScopedRepository } from '../database/workspace-scoped.repository';
import { conditionalUpdate } from '../common/mongo/conditional-update';
import {
  WorkItemDocument,
  WorkItemPriority,
  WorkItemType,
} from './work-item.schema';

export interface WorkItemListFilters {
  assigneeId?: string;
  priority?: WorkItemPriority;
  label?: string;
  type?: WorkItemType;
  q?: string;
  includeArchived?: boolean;
}

export type NewWorkItem = Pick<
  WorkItemDocument,
  | 'workspaceId'
  | 'issueKey'
  | 'projectId'
  | 'boardId'
  | 'columnId'
  | 'rank'
  | 'type'
  | 'priority'
  | 'title'
  | 'description'
  | 'reporterId'
  | 'assigneeId'
  | 'labels'
  | 'dueDate'
  | 'acceptanceNotes'
>;

@Injectable()
export class WorkItemsRepository extends WorkspaceScopedRepository<WorkItemDocument> {
  constructor(databaseService: DatabaseService) {
    super(databaseService.getCollection<WorkItemDocument>('work_items'));
  }

  findById(workspaceId: string, itemId: string) {
    if (!ObjectId.isValid(itemId)) return Promise.resolve(null);
    return this.findOneScoped(workspaceId, { _id: new ObjectId(itemId) });
  }

  async create(item: NewWorkItem) {
    const now = new Date();
    const toInsert: Omit<WorkItemDocument, '_id'> = {
      ...item,
      archivedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.collection.insertOne(toInsert);
    return { ...toInsert, _id: result.insertedId };
  }

  updateFields(
    workspaceId: string,
    itemId: string,
    expectedVersion: number,
    patch: Partial<
      Pick<
        WorkItemDocument,
        'title' | 'description' | 'type' | 'priority' | 'labels' | 'dueDate' | 'acceptanceNotes'
      >
    >,
  ) {
    return conditionalUpdate(
      this.collection,
      { _id: new ObjectId(itemId), workspaceId, archivedAt: null },
      expectedVersion,
      { $set: patch },
    );
  }

  assign(workspaceId: string, itemId: string, expectedVersion: number, assigneeId: string | null) {
    return conditionalUpdate(
      this.collection,
      { _id: new ObjectId(itemId), workspaceId, archivedAt: null },
      expectedVersion,
      { $set: { assigneeId } },
    );
  }

  move(
    workspaceId: string,
    itemId: string,
    expectedVersion: number,
    columnId: string,
    rank: number,
  ) {
    return conditionalUpdate(
      this.collection,
      { _id: new ObjectId(itemId), workspaceId, archivedAt: null },
      expectedVersion,
      { $set: { columnId, rank } },
    );
  }

  archive(workspaceId: string, itemId: string, expectedVersion: number) {
    return conditionalUpdate(
      this.collection,
      { _id: new ObjectId(itemId), workspaceId, archivedAt: null },
      expectedVersion,
      { $set: { archivedAt: new Date() } },
    );
  }

  /** Highest rank currently in a column - used to append a new/moved
   * item to the end. */
  async maxRankInColumn(workspaceId: string, boardId: string, columnId: string): Promise<number | null> {
    const [top] = await this.findScoped(
      workspaceId,
      { boardId, columnId, archivedAt: null },
      { sort: { rank: -1 }, limit: 1 },
    );
    return top ? top.rank : null;
  }

  /** All items in a column, ordered by rank - used for reorder
   * (finding neighbors) and rebalancing. */
  listColumnOrdered(workspaceId: string, boardId: string, columnId: string) {
    return this.findScoped(
      workspaceId,
      { boardId, columnId, archivedAt: null },
      { sort: { rank: 1 } },
    );
  }

  async rebalanceColumn(
    workspaceId: string,
    boardId: string,
    columnId: string,
    ranksByItemId: Map<string, number>,
  ): Promise<void> {
    const operations = Array.from(ranksByItemId.entries()).map(([itemId, rank]) => ({
      updateOne: {
        filter: { _id: new ObjectId(itemId), workspaceId, boardId, columnId },
        update: { $set: { rank, updatedAt: new Date() } },
      },
    }));
    if (operations.length === 0) return;
    await this.collection.bulkWrite(operations);
  }

  async listByProject(
    workspaceId: string,
    projectId: string,
    filters: WorkItemListFilters,
    cursorId: ObjectId | null,
    limitPlusOne: number,
  ) {
    const filter: Filter<WorkItemDocument> = { projectId };
    if (!filters.includeArchived) {
      (filter as Record<string, unknown>).archivedAt = null;
    }
    if (filters.assigneeId) (filter as Record<string, unknown>).assigneeId = filters.assigneeId;
    if (filters.priority) (filter as Record<string, unknown>).priority = filters.priority;
    if (filters.type) (filter as Record<string, unknown>).type = filters.type;
    if (filters.label) (filter as Record<string, unknown>).labels = filters.label;
    if (filters.q) (filter as Record<string, unknown>).$text = { $search: filters.q };
    if (cursorId) (filter as Record<string, unknown>)._id = { $gt: cursorId };

    return this.findScoped(workspaceId, filter, { sort: { _id: 1 }, limit: limitPlusOne });
  }
}

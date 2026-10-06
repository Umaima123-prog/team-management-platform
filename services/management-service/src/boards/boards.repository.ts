import { Injectable } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { WorkspaceScopedRepository } from '../database/workspace-scoped.repository';
import { BoardDocument, DEFAULT_COLUMN_NAMES } from './board.schema';

@Injectable()
export class BoardsRepository extends WorkspaceScopedRepository<BoardDocument> {
  constructor(databaseService: DatabaseService) {
    super(databaseService.getCollection<BoardDocument>('boards'));
  }

  findById(workspaceId: string, boardId: string) {
    if (!ObjectId.isValid(boardId)) return Promise.resolve(null);
    return this.findOneScoped(workspaceId, { _id: new ObjectId(boardId) });
  }

  findByProjectId(workspaceId: string, projectId: string) {
    return this.findOneScoped(workspaceId, { projectId });
  }

  /** One board per project, created with the Jira-like default columns
   * (docs/ARCHITECTURE.md). There is no API to add/remove/reorder
   * columns in Phase 3 - only to create a project's initial board. */
  async createDefaultBoard(workspaceId: string, projectId: string) {
    const now = new Date();
    const toInsert: Omit<BoardDocument, '_id'> = {
      workspaceId,
      projectId,
      columns: DEFAULT_COLUMN_NAMES.map((name, order) => ({
        id: randomUUID(),
        name,
        order,
        wipLimit: null,
      })),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.collection.insertOne(toInsert);
    return { ...toInsert, _id: result.insertedId };
  }
}

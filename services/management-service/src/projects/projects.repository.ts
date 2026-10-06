import { ConflictException, Injectable } from '@nestjs/common';
import { Filter, ObjectId } from 'mongodb';
import { DatabaseService } from '../database/database.service';
import { WorkspaceScopedRepository } from '../database/workspace-scoped.repository';
import { conditionalUpdate } from '../common/mongo/conditional-update';
import { isDuplicateKeyError } from '../common/mongo/duplicate-key.util';
import { ErrorCode } from '../common/errors/error-codes';
import { ProjectDocument } from './project.schema';

export type NewProject = Pick<
  ProjectDocument,
  'workspaceId' | 'projectKey' | 'name' | 'description' | 'ownerId' | 'teamId' | 'startDate' | 'endDate'
>;

@Injectable()
export class ProjectsRepository extends WorkspaceScopedRepository<ProjectDocument> {
  constructor(databaseService: DatabaseService) {
    super(databaseService.getCollection<ProjectDocument>('projects'));
  }

  findById(workspaceId: string, projectId: string) {
    if (!ObjectId.isValid(projectId)) return Promise.resolve(null);
    return this.findOneScoped(workspaceId, { _id: new ObjectId(projectId) });
  }

  findByKey(workspaceId: string, projectKey: string) {
    return this.findOneScoped(workspaceId, { projectKey });
  }

  list(workspaceId: string, includeArchived: boolean) {
    const filter = includeArchived ? {} : ({ archivedAt: null } as Filter<ProjectDocument>);
    return this.findScoped(workspaceId, filter, { sort: { createdAt: -1 } });
  }

  async create(project: NewProject) {
    const now = new Date();
    const toInsert: Omit<ProjectDocument, '_id'> = {
      ...project,
      status: 'ACTIVE',
      archivedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    try {
      const result = await this.collection.insertOne(toInsert);
      return { ...toInsert, _id: result.insertedId };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: `Project key "${project.projectKey}" is already in use in this workspace.`,
        });
      }
      throw error;
    }
  }

  updateDetails(
    workspaceId: string,
    projectId: string,
    expectedVersion: number,
    patch: Partial<
      Pick<ProjectDocument, 'name' | 'description' | 'ownerId' | 'teamId' | 'startDate' | 'endDate'>
    >,
  ) {
    return conditionalUpdate(
      this.collection,
      { _id: new ObjectId(projectId), workspaceId, archivedAt: null },
      expectedVersion,
      { $set: patch },
    );
  }

  archive(workspaceId: string, projectId: string, expectedVersion: number) {
    return conditionalUpdate(
      this.collection,
      { _id: new ObjectId(projectId), workspaceId, archivedAt: null },
      expectedVersion,
      { $set: { archivedAt: new Date(), status: 'ARCHIVED' } },
    );
  }
}

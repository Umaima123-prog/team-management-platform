import { ConflictException, Injectable } from '@nestjs/common';
import { ClientSession, Filter, ObjectId } from 'mongodb';
import { DatabaseService } from '../database/database.service';
import { WorkspaceScopedRepository } from '../database/workspace-scoped.repository';
import { conditionalUpdate } from '../common/mongo/conditional-update';
import { isDuplicateKeyError } from '../common/mongo/duplicate-key.util';
import { ErrorCode } from '../common/errors/error-codes';
import { TeamDocument } from './team.schema';

export type NewTeam = Pick<TeamDocument, 'workspaceId' | 'code' | 'name' | 'description'>;

@Injectable()
export class TeamsRepository extends WorkspaceScopedRepository<TeamDocument> {
  constructor(databaseService: DatabaseService) {
    super(databaseService.getCollection<TeamDocument>('teams'));
  }

  findById(workspaceId: string, teamId: string) {
    if (!ObjectId.isValid(teamId)) return Promise.resolve(null);
    return this.findOneScoped(workspaceId, { _id: new ObjectId(teamId) });
  }

  findByCode(workspaceId: string, code: string) {
    return this.findOneScoped(workspaceId, { code });
  }

  list(workspaceId: string, includeArchived: boolean) {
    const filter = includeArchived ? {} : ({ archivedAt: null } as Filter<TeamDocument>);
    return this.findScoped(workspaceId, filter, { sort: { createdAt: -1 } });
  }

  async create(team: NewTeam, session?: ClientSession) {
    const existing = await this.findOneScoped(team.workspaceId, { code: team.code }, { session });
    if (existing) {
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: `Team code "${team.code}" is already in use in this workspace.`,
      });
    }

    const now = new Date();
    const toInsert: Omit<TeamDocument, '_id'> = {
      ...team,
      archivedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    try {
      const result = await this.collection.insertOne(toInsert, { session });
      return { ...toInsert, _id: result.insertedId };
    } catch (error) {
      // Belt-and-suspenders against the race between the check above
      // and this insert: the unique index is the real guarantee.
      if (isDuplicateKeyError(error)) {
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: `Team code "${team.code}" is already in use in this workspace.`,
        });
      }
      throw error;
    }
  }

  updateDetails(
    workspaceId: string,
    teamId: string,
    expectedVersion: number,
    patch: Partial<Pick<TeamDocument, 'name' | 'description'>>,
  ) {
    return conditionalUpdate(
      this.collection,
      { _id: new ObjectId(teamId), workspaceId, archivedAt: null },
      expectedVersion,
      { $set: patch },
    );
  }

  archive(workspaceId: string, teamId: string, expectedVersion: number) {
    return conditionalUpdate(
      this.collection,
      { _id: new ObjectId(teamId), workspaceId, archivedAt: null },
      expectedVersion,
      { $set: { archivedAt: new Date() } },
    );
  }
}

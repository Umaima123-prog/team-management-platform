import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Filter } from 'mongodb';
import { DatabaseService } from '../database/database.service';
import { WorkspaceScopedRepository } from '../database/workspace-scoped.repository';
import { ErrorCode } from '../common/errors/error-codes';
import { MembershipDocument, TeamRole } from './membership.schema';

@Injectable()
export class MembershipsRepository extends WorkspaceScopedRepository<MembershipDocument> {
  constructor(databaseService: DatabaseService) {
    super(databaseService.getCollection<MembershipDocument>('memberships'));
  }

  findActive(workspaceId: string, teamId: string, userId: string) {
    return this.findOneScoped(workspaceId, {
      teamId,
      userId,
      removedAt: null,
    });
  }

  async isActiveMember(workspaceId: string, teamId: string, userId: string): Promise<boolean> {
    const membership = await this.findActive(workspaceId, teamId, userId);
    return membership !== null;
  }

  listByTeam(workspaceId: string, teamId: string) {
    return this.findScoped(workspaceId, { teamId, removedAt: null }, {
      sort: { createdAt: 1 },
    });
  }

  /** Adds a member, or reactivates a previously-removed membership
   * (see membership.schema.ts for why removal is soft-delete). */
  async addMember(workspaceId: string, teamId: string, userId: string, role: TeamRole) {
    const now = new Date();
    const existing = await this.collection.findOne({
      workspaceId,
      teamId,
      userId,
    } as Filter<MembershipDocument>);

    if (existing && existing.removedAt === null) {
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: 'This user is already a member of this team.',
      });
    }

    if (existing) {
      const result = await this.collection.findOneAndUpdate(
        { _id: existing._id },
        { $set: { role, removedAt: null, updatedAt: now } },
        { returnDocument: 'after' },
      );
      return result!;
    }

    const toInsert: Omit<MembershipDocument, '_id'> = {
      workspaceId,
      teamId,
      userId,
      role,
      removedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const insertResult = await this.collection.insertOne(toInsert);
    return { ...toInsert, _id: insertResult.insertedId };
  }

  async updateRole(workspaceId: string, teamId: string, userId: string, role: TeamRole) {
    const result = await this.collection.findOneAndUpdate(
      { workspaceId, teamId, userId, removedAt: null },
      { $set: { role, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!result) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Active membership not found.',
      });
    }
    return result;
  }

  async remove(workspaceId: string, teamId: string, userId: string) {
    const result = await this.collection.findOneAndUpdate(
      { workspaceId, teamId, userId, removedAt: null },
      { $set: { removedAt: new Date(), updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!result) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Active membership not found.',
      });
    }
    return result;
  }

  countActiveByRole(workspaceId: string, teamId: string, role: TeamRole) {
    return this.countScoped(workspaceId, { teamId, role, removedAt: null });
  }
}

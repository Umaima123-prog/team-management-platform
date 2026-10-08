import { BadRequestException, Injectable } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { DatabaseService } from '../database/database.service';
import { WorkspaceScopedRepository } from '../database/workspace-scoped.repository';
import { ErrorCode } from '../common/errors/error-codes';
import { UserDocument } from './user.schema';

@Injectable()
export class UsersRepository extends WorkspaceScopedRepository<UserDocument> {
  constructor(databaseService: DatabaseService) {
    super(databaseService.getCollection<UserDocument>('users'));
  }

  list(workspaceId: string) {
    return this.findScoped(workspaceId, {}, { sort: { name: 1 } });
  }

  findById(workspaceId: string, userId: string) {
    if (!ObjectId.isValid(userId)) return Promise.resolve(null);
    return this.findOneScoped(workspaceId, { _id: new ObjectId(userId) });
  }

  /**
   * Login's one legitimate exception to "every query is workspace-
   * scoped": at the point of login there IS no workspaceId yet - the
   * email the caller typed is the only thing available to resolve
   * one from. The unique index is `{workspaceId, email}` (scoped), not
   * a global email uniqueness guarantee, but this deployment seeds
   * exactly one workspace, so in practice this always resolves to at
   * most one real match. Never used anywhere a workspaceId is already
   * known - every other method on this class stays scoped.
   */
  findByEmailAnyWorkspace(email: string) {
    return this.collection.findOne({ email } as never);
  }

  /** Bumps the counter embedded in every refresh token issued for this
   * user, so logout (or a future password-change flow) invalidates
   * every refresh token issued before now without a separate
   * token-blacklist collection - see auth.service.ts. */
  async incrementTokenVersion(workspaceId: string, userId: string): Promise<void> {
    await this.collection.updateOne(
      { _id: new ObjectId(userId), workspaceId } as never,
      { $inc: { tokenVersion: 1 } } as never,
    );
  }

  /**
   * Validates that `userId` is a real user in `workspaceId` - the
   * check backing "reporter must be a valid workspace user",
   * "owner ... must belong to the same workspace", etc. Throws a
   * stable 400 (not a raw lookup failure) so every caller gets the
   * same cross-workspace-reference rejection behavior.
   */
  async assertBelongsToWorkspace(workspaceId: string, userId: string, fieldName: string): Promise<void> {
    const user = await this.findById(workspaceId, userId);
    if (!user) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: `${fieldName} must reference a user in the same workspace.`,
      });
    }
  }
}

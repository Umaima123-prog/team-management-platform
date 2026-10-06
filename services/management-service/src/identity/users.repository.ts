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

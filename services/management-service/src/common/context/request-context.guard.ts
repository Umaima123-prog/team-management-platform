import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ObjectId } from 'mongodb';
import { DatabaseService } from '../../database/database.service';
import { ErrorCode } from '../errors/error-codes';
import { IS_PUBLIC_KEY } from './public.decorator';
import { RequestContext } from './request-context';

interface UserDocument {
  _id: ObjectId;
  workspaceId: string;
}

interface RequestWithContext extends Request {
  context?: RequestContext;
}

const DEV_USER_HEADER = 'x-dev-user-id';

/**
 * Development-only trust mechanism (see docs/ARCHITECTURE.md -
 * "Request context / trust model" - for the honest explanation of why
 * this exists and what replaces it later).
 *
 * The caller identifies themselves via the X-Dev-User-Id header - this
 * stands in for "the user a real auth system authenticated." The
 * server then looks that user up and derives workspaceId from the
 * user's own record. The browser never supplies workspaceId directly,
 * and nothing downstream trusts one that did - every authoritative
 * write/read is scoped to the workspaceId resolved here.
 */
@Injectable()
export class RequestContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly databaseService: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const header = request.headers[DEV_USER_HEADER];
    const userId = Array.isArray(header) ? header[0] : header;

    if (!userId || !ObjectId.isValid(userId)) {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHENTICATED,
        message:
          'X-Dev-User-Id header is required and must be a valid user id. ' +
          'This is a documented development-only trust mechanism - see docs/ARCHITECTURE.md.',
      });
    }

    const user = await this.databaseService
      .getCollection<UserDocument>('users')
      .findOne({ _id: new ObjectId(userId) });

    if (!user) {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Unknown user.',
      });
    }

    request.context = { userId: user._id.toHexString(), workspaceId: user.workspaceId };
    return true;
  }
}

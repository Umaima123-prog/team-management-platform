import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ErrorCode } from '../common/errors/error-codes';
import { RequestContext } from '../common/context/request-context';
import { IS_PUBLIC_KEY } from '../common/context/public.decorator';
import { UserRole } from '../identity/user.schema';
import { ROLES_KEY } from './roles.decorator';

interface RequestWithContext extends Request {
  context?: RequestContext;
}

/**
 * Authorization (403), separate from authentication (401, handled by
 * RequestContextGuard). Runs after it, so `request.context` - built
 * entirely from the verified JWT, never a client-supplied value - is
 * always present by the time this reads `context.role`. A route with
 * no `@Roles(...)` metadata is allowed for any authenticated role;
 * `@Public()` routes (login/refresh/health) never reach either guard
 * meaningfully, but are checked here too for defense in depth.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const role = request.context?.role;

    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN,
        message: `This action requires one of the following roles: ${requiredRoles.join(', ')}.`,
      });
    }
    return true;
  }
}

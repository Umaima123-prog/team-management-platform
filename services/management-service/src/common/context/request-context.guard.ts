import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { Request } from 'express';
import { ErrorCode } from '../errors/error-codes';
import { IS_PUBLIC_KEY } from './public.decorator';
import { RequestContext } from './request-context';
import { JwtSigner } from '../../auth/jwt.util';
import { UsersRepository } from '../../identity/users.repository';

interface RequestWithContext extends Request {
  context?: RequestContext;
  correlationId?: string;
}

/**
 * Real authentication (Phase 9 - see docs/DECISIONS.md for the
 * migration from the Phase 3 X-Dev-User-Id development header, which
 * this guard no longer accepts or trusts in any way).
 *
 * The caller presents a JWT access token via `Authorization: Bearer
 * <token>`. This guard verifies its signature/expiry, then - because
 * an authorization-sensitive field (role, active) can change after a
 * token was issued and short-lived access tokens are still a window
 * an admin might need to close immediately (e.g. deactivating someone
 * mid-session) - re-reads the live user record by the token's own
 * `sub` claim rather than trusting the token's claims at face value
 * for anything but identity. `workspaceId` IS trusted from the token:
 * it was never client-supplied, it is a claim *this service itself*
 * signed at login time from the user's own stored record (the same
 * non-negotiable rule docs/ARCHITECTURE.md's "Request context / trust
 * model" has always applied, just moved from "header lookup" to
 * "token verification" exactly as that section anticipated).
 */
@Injectable()
export class RequestContextGuard implements CanActivate {
  private readonly jwtSigner: JwtSigner;

  constructor(
    private readonly reflector: Reflector,
    private readonly usersRepository: UsersRepository,
    config: ConfigService,
  ) {
    this.jwtSigner = new JwtSigner(config);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const authHeader = request.headers.authorization;
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : undefined;

    if (!token) {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Authorization: Bearer <token> is required.',
      });
    }

    let payload;
    try {
      payload = this.jwtSigner.verifyAccessToken(token);
    } catch {
      // Never echo jwt.verify's own error detail (e.g. exact expiry
      // timestamp) to the client - a generic 401 either way.
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Invalid or expired access token.',
      });
    }

    const user = await this.usersRepository.findById(payload.workspaceId, payload.sub);
    if (!user || !user.active) {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Unknown or inactive user.',
      });
    }

    request.context = {
      userId: user._id.toHexString(),
      workspaceId: user.workspaceId,
      // The live record's role, not the token's claim - so a role
      // change (e.g. demotion) takes effect on the very next request,
      // not only once the short-lived access token itself expires.
      role: user.role,
      // CorrelationIdMiddleware runs before every guard and always sets
      // this - the fallback only guards against a misconfigured test
      // harness that bypasses the middleware chain.
      correlationId: request.correlationId ?? randomUUID(),
    };
    return true;
  }
}

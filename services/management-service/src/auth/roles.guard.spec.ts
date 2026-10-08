import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { RequestContext } from '../common/context/request-context';

function contextWith(role: string | undefined) {
  const request: { context?: RequestContext } = role
    ? { context: { userId: 'u1', workspaceId: 'ws-1', role: role as never, correlationId: 'c1' } }
    : {};
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return ctx;
}

describe('RolesGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('allows a route with no @Roles() metadata for any authenticated role', () => {
    reflector.getAllAndOverride.mockReturnValueOnce(false); // isPublic
    reflector.getAllAndOverride.mockReturnValueOnce(undefined); // required roles
    expect(guard.canActivate(contextWith('EMPLOYEE'))).toBe(true);
  });

  it('allows an ADMIN-only route when the caller is ADMIN', () => {
    reflector.getAllAndOverride.mockReturnValueOnce(false);
    reflector.getAllAndOverride.mockReturnValueOnce(['ADMIN']);
    expect(guard.canActivate(contextWith('ADMIN'))).toBe(true);
  });

  it('rejects an ADMIN-only route when the caller is EMPLOYEE, with a 403', () => {
    reflector.getAllAndOverride.mockReturnValueOnce(false);
    reflector.getAllAndOverride.mockReturnValueOnce(['ADMIN']);
    expect(() => guard.canActivate(contextWith('EMPLOYEE'))).toThrow(ForbiddenException);
  });

  it('rejects when there is no established context at all (defense in depth)', () => {
    reflector.getAllAndOverride.mockReturnValueOnce(false);
    reflector.getAllAndOverride.mockReturnValueOnce(['ADMIN']);
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(ForbiddenException);
  });

  it('skips the role check entirely for @Public() routes', () => {
    reflector.getAllAndOverride.mockReturnValueOnce(true); // isPublic
    expect(guard.canActivate(contextWith(undefined))).toBe(true);
  });
});

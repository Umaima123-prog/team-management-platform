import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ObjectId } from 'mongodb';
import { DatabaseService } from '../../database/database.service';
import { RequestContextGuard } from './request-context.guard';

function contextWith(headers: Record<string, string>) {
  const request: { headers: Record<string, string>; context?: unknown } = { headers };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('RequestContextGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let findOne: jest.Mock;
  let databaseService: { getCollection: jest.Mock };
  let guard: RequestContextGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    findOne = jest.fn();
    databaseService = { getCollection: jest.fn().mockReturnValue({ findOne }) };
    guard = new RequestContextGuard(
      reflector as unknown as Reflector,
      databaseService as unknown as DatabaseService,
    );
  });

  it('allows @Public() routes through without touching the database', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { ctx } = contextWith({});

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('rejects a missing X-Dev-User-Id header', async () => {
    const { ctx } = contextWith({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a header that is not a valid id - never reaches the database', async () => {
    const { ctx } = contextWith({ 'x-dev-user-id': 'not-an-object-id' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('rejects a well-formed id that does not resolve to a real user', async () => {
    findOne.mockResolvedValue(null);
    const { ctx } = contextWith({ 'x-dev-user-id': new ObjectId().toHexString() });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('never trusts a client-supplied workspaceId - it is derived from the resolved user', async () => {
    const userId = new ObjectId();
    findOne.mockResolvedValue({ _id: userId, workspaceId: 'real-workspace' });
    const { ctx, request } = contextWith({
      'x-dev-user-id': userId.toHexString(),
      // Even if a client tried to smuggle one in, nothing reads this -
      // RequestContext only ever comes from the DB lookup above.
      'x-workspace-id': 'attacker-supplied-workspace',
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.context).toEqual({
      userId: userId.toHexString(),
      workspaceId: 'real-workspace',
    });
  });
});

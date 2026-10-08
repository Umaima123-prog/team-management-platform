import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { RequestContextGuard } from './request-context.guard';
import { UsersRepository } from '../../identity/users.repository';

const ACCESS_SECRET = 'guard-spec-access-secret';
const REFRESH_SECRET = 'guard-spec-refresh-secret';

function fakeConfig(): ConfigService {
  const values: Record<string, string> = {
    JWT_SECRET: ACCESS_SECRET,
    JWT_REFRESH_SECRET: REFRESH_SECRET,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function signAccessToken(payload: Record<string, unknown>, secret = ACCESS_SECRET): string {
  return jwt.sign({ type: 'access', ...payload }, secret, { expiresIn: '15m' });
}

function contextWith(authorizationHeader?: string) {
  const request: {
    headers: Record<string, string | undefined>;
    context?: unknown;
    correlationId?: string;
  } = {
    headers: { authorization: authorizationHeader },
    correlationId: 'test-correlation-id',
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('RequestContextGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let findById: jest.Mock;
  let usersRepository: { findById: jest.Mock };
  let guard: RequestContextGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    findById = jest.fn();
    usersRepository = { findById };
    guard = new RequestContextGuard(
      reflector as unknown as Reflector,
      usersRepository as unknown as UsersRepository,
      fakeConfig(),
    );
  });

  it('allows @Public() routes through without touching the database', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { ctx } = contextWith(undefined);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(findById).not.toHaveBeenCalled();
  });

  it('rejects a missing Authorization header', async () => {
    const { ctx } = contextWith(undefined);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a malformed/garbage bearer token - never reaches the database', async () => {
    const { ctx } = contextWith('Bearer not-a-real-jwt');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(findById).not.toHaveBeenCalled();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = signAccessToken(
      { sub: new ObjectId().toHexString(), workspaceId: 'ws-1', role: 'ADMIN' },
      'wrong-secret',
    );
    const { ctx } = contextWith(`Bearer ${token}`);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(findById).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    const token = jwt.sign(
      { type: 'access', sub: new ObjectId().toHexString(), workspaceId: 'ws-1', role: 'ADMIN' },
      ACCESS_SECRET,
      { expiresIn: -1 },
    );
    const { ctx } = contextWith(`Bearer ${token}`);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a refresh token presented as an access token', async () => {
    const token = jwt.sign(
      { type: 'refresh', sub: new ObjectId().toHexString(), workspaceId: 'ws-1', tokenVersion: 0 },
      ACCESS_SECRET,
      { expiresIn: '15m' },
    );
    const { ctx } = contextWith(`Bearer ${token}`);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a well-formed token whose user no longer exists', async () => {
    findById.mockResolvedValue(null);
    const token = signAccessToken({ sub: new ObjectId().toHexString(), workspaceId: 'ws-1', role: 'ADMIN' });
    const { ctx } = contextWith(`Bearer ${token}`);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token for a deactivated user, even though the token itself is still valid', async () => {
    const userId = new ObjectId();
    findById.mockResolvedValue({ _id: userId, workspaceId: 'ws-1', role: 'ADMIN', active: false });
    const token = signAccessToken({ sub: userId.toHexString(), workspaceId: 'ws-1', role: 'ADMIN' });
    const { ctx } = contextWith(`Bearer ${token}`);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('builds RequestContext from the live user record, not blindly from the token claims', async () => {
    const userId = new ObjectId();
    // Token claims ADMIN; the live record has since been demoted to
    // EMPLOYEE - the live record must win, proving a role change takes
    // effect immediately rather than only once the token expires.
    findById.mockResolvedValue({ _id: userId, workspaceId: 'real-workspace', role: 'EMPLOYEE', active: true });
    const token = signAccessToken({ sub: userId.toHexString(), workspaceId: 'real-workspace', role: 'ADMIN' });
    const { ctx, request } = contextWith(`Bearer ${token}`);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.context).toEqual({
      userId: userId.toHexString(),
      workspaceId: 'real-workspace',
      role: 'EMPLOYEE',
      correlationId: 'test-correlation-id',
    });
  });

  it('never trusts a client-supplied workspaceId/userId via headers or body - only the verified token', async () => {
    const userId = new ObjectId();
    findById.mockResolvedValue({ _id: userId, workspaceId: 'real-workspace', role: 'ADMIN', active: true });
    const token = signAccessToken({ sub: userId.toHexString(), workspaceId: 'real-workspace', role: 'ADMIN' });
    const { ctx, request } = contextWith(`Bearer ${token}`);
    // Simulates an attacker also sending headers that claim a
    // different identity - nothing reads these.
    request.headers['x-dev-user-id'] = new ObjectId().toHexString();
    request.headers['x-workspace-id'] = 'attacker-supplied-workspace';

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(findById).toHaveBeenCalledWith('real-workspace', userId.toHexString());
    expect(request.context).toMatchObject({ userId: userId.toHexString(), workspaceId: 'real-workspace' });
  });
});

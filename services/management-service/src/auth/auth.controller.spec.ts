import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersRepository } from '../identity/users.repository';

function fakeRes(): { cookie: jest.Mock; clearCookie: jest.Mock } {
  return { cookie: jest.fn(), clearCookie: jest.fn() };
}

function fakeConfig(nodeEnv = 'development'): ConfigService {
  return { get: () => nodeEnv } as unknown as ConfigService;
}

describe('AuthController', () => {
  let authService: {
    login: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
    refreshCookieMaxAgeMs: number;
  };
  let usersRepository: { findById: jest.Mock };
  let controller: AuthController;

  const publicUser = {
    id: 'u1',
    workspaceId: 'ws-1',
    name: 'Alice Owner',
    email: 'alice@example.test',
    role: 'ADMIN' as const,
    active: true,
  };

  beforeEach(() => {
    authService = {
      login: jest.fn().mockResolvedValue({ accessToken: 'access.jwt', refreshToken: 'refresh.jwt', user: publicUser }),
      refresh: jest.fn().mockResolvedValue({ accessToken: 'new-access.jwt', refreshToken: 'new-refresh.jwt', user: publicUser }),
      logout: jest.fn().mockResolvedValue(undefined),
      refreshCookieMaxAgeMs: 604_800_000,
    };
    usersRepository = { findById: jest.fn().mockResolvedValue({ name: publicUser.name, email: publicUser.email, active: true }) };
    controller = new AuthController(
      authService as unknown as AuthService,
      usersRepository as unknown as UsersRepository,
      fakeConfig(),
    );
  });

  it('login sets an HttpOnly refresh cookie and returns the access token + user, never the refresh token, in the body', async () => {
    const res = fakeRes();
    const result = await controller.login({ email: 'alice@example.test', password: 'correct' }, res as unknown as Response);

    expect(result).toEqual({ accessToken: 'access.jwt', user: publicUser });
    expect(JSON.stringify(result)).not.toContain('refresh.jwt');
    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh.jwt',
      expect.objectContaining({ httpOnly: true, path: '/api/auth' }),
    );
  });

  it('login propagates a wrong-credentials rejection without setting any cookie', async () => {
    authService.login.mockRejectedValue(new UnauthorizedException());
    const res = fakeRes();
    await expect(
      controller.login({ email: 'alice@example.test', password: 'wrong' }, res as unknown as Response),
    ).rejects.toThrow(UnauthorizedException);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('refresh reads the cookie, rotates it, and never requires a request body', async () => {
    const res = fakeRes();
    const req = { cookies: { refresh_token: 'old-refresh.jwt' } } as never;
    const result = await controller.refresh(req, res as unknown as Response);

    expect(authService.refresh).toHaveBeenCalledWith('old-refresh.jwt');
    expect(result).toEqual({ accessToken: 'new-access.jwt', user: publicUser });
    expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'new-refresh.jwt', expect.anything());
  });

  it('logout clears the cookie even when the refresh token was already invalid', async () => {
    authService.refresh.mockRejectedValue(new UnauthorizedException());
    const res = fakeRes();
    const req = { cookies: { refresh_token: 'already-expired.jwt' } } as never;

    await controller.logout(req, res as unknown as Response);

    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', expect.anything());
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('logout invalidates the server-side session when the refresh token was valid', async () => {
    const res = fakeRes();
    const req = { cookies: { refresh_token: 'valid-refresh.jwt' } } as never;

    await controller.logout(req, res as unknown as Response);

    expect(authService.logout).toHaveBeenCalledWith(publicUser.workspaceId, publicUser.id);
    expect(res.clearCookie).toHaveBeenCalled();
  });

  it('me returns the authenticated context, not anything the client could claim to be', async () => {
    const ctx = { userId: 'u1', workspaceId: 'ws-1', role: 'ADMIN' as const, correlationId: 'c1' };
    const result = await controller.me(ctx);
    expect(result).toEqual({
      id: 'u1',
      workspaceId: 'ws-1',
      role: 'ADMIN',
      name: publicUser.name,
      email: publicUser.email,
      active: true,
    });
  });
});

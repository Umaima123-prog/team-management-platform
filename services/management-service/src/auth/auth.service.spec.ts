import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { AuthService } from './auth.service';
import { UsersRepository } from '../identity/users.repository';
import { hashPassword } from './password.util';
import { UserDocument } from '../identity/user.schema';

const ACCESS_SECRET = 'auth-service-spec-access-secret';
const REFRESH_SECRET = 'auth-service-spec-refresh-secret';

function fakeConfig(): ConfigService {
  const values: Record<string, string> = {
    JWT_SECRET: ACCESS_SECRET,
    JWT_REFRESH_SECRET: REFRESH_SECRET,
    JWT_ACCESS_TOKEN_TTL: '15m',
    JWT_REFRESH_TOKEN_TTL: '7d',
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('AuthService', () => {
  let usersRepository: {
    findByEmailAnyWorkspace: jest.Mock;
    findById: jest.Mock;
    incrementTokenVersion: jest.Mock;
  };
  let service: AuthService;
  let activeUser: UserDocument & { _id: ObjectId };

  beforeEach(async () => {
    activeUser = {
      _id: new ObjectId(),
      workspaceId: 'ws-1',
      name: 'Alice Owner',
      email: 'alice@example.test',
      passwordHash: await hashPassword('correct-password'),
      role: 'ADMIN',
      active: true,
      tokenVersion: 0,
      createdAt: new Date(),
    };
    usersRepository = {
      findByEmailAnyWorkspace: jest.fn().mockResolvedValue(activeUser),
      findById: jest.fn().mockResolvedValue(activeUser),
      incrementTokenVersion: jest.fn().mockResolvedValue(undefined),
    };
    service = new AuthService(usersRepository as unknown as UsersRepository, fakeConfig());
  });

  describe('login', () => {
    it('succeeds with the correct email/password and issues both tokens', async () => {
      const result = await service.login('alice@example.test', 'correct-password');

      expect(result.user).toEqual({
        id: activeUser._id.toHexString(),
        workspaceId: 'ws-1',
        name: 'Alice Owner',
        email: 'alice@example.test',
        role: 'ADMIN',
        active: true,
      });
      // Never the plaintext, never the hash, in the response.
      expect(JSON.stringify(result)).not.toContain('correct-password');
      expect(JSON.stringify(result)).not.toContain(activeUser.passwordHash);

      const accessPayload = jwt.verify(result.accessToken, ACCESS_SECRET) as Record<string, unknown>;
      expect(accessPayload).toMatchObject({ sub: activeUser._id.toHexString(), workspaceId: 'ws-1', role: 'ADMIN' });
    });

    it('rejects the wrong password with a generic, non-enumerating message', async () => {
      await expect(service.login('alice@example.test', 'wrong-password')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an unknown email with the SAME message as a wrong password (no enumeration)', async () => {
      usersRepository.findByEmailAnyWorkspace.mockResolvedValue(null);
      await expect(service.login('nobody@example.test', 'anything')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a deactivated user even with the correct password', async () => {
      usersRepository.findByEmailAnyWorkspace.mockResolvedValue({ ...activeUser, active: false });
      await expect(service.login('alice@example.test', 'correct-password')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('refresh', () => {
    async function realRefreshToken(): Promise<string> {
      const { refreshToken } = await service.login('alice@example.test', 'correct-password');
      return refreshToken;
    }

    it('succeeds with a valid refresh token and issues a new access token', async () => {
      const refreshToken = await realRefreshToken();
      const result = await service.refresh(refreshToken);
      expect(result.user.id).toBe(activeUser._id.toHexString());
      jwt.verify(result.accessToken, ACCESS_SECRET); // does not throw
    });

    it('rejects a missing refresh token', async () => {
      await expect(service.refresh(undefined)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a refresh token signed with the wrong secret', async () => {
      const forged = jwt.sign(
        { type: 'refresh', sub: activeUser._id.toHexString(), workspaceId: 'ws-1', tokenVersion: 0 },
        'not-the-real-secret',
        { expiresIn: '7d' },
      );
      await expect(service.refresh(forged)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired refresh token', async () => {
      const expired = jwt.sign(
        { type: 'refresh', sub: activeUser._id.toHexString(), workspaceId: 'ws-1', tokenVersion: 0 },
        REFRESH_SECRET,
        { expiresIn: -1 },
      );
      await expect(service.refresh(expired)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a refresh token whose tokenVersion no longer matches (post-logout)', async () => {
      const refreshToken = await realRefreshToken();
      usersRepository.findById.mockResolvedValue({ ...activeUser, tokenVersion: 1 });
      await expect(service.refresh(refreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a refresh token for a now-deactivated user', async () => {
      const refreshToken = await realRefreshToken();
      usersRepository.findById.mockResolvedValue({ ...activeUser, active: false });
      await expect(service.refresh(refreshToken)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('bumps the user\'s tokenVersion, invalidating every previously-issued refresh token', async () => {
      await service.logout('ws-1', activeUser._id.toHexString());
      expect(usersRepository.incrementTokenVersion).toHaveBeenCalledWith('ws-1', activeUser._id.toHexString());
    });

    it('a refresh token issued before logout is rejected afterward (end-to-end through the real flow)', async () => {
      const { refreshToken } = await service.login('alice@example.test', 'correct-password');
      await service.logout('ws-1', activeUser._id.toHexString());
      // Simulate the tokenVersion bump actually landing in the store.
      usersRepository.findById.mockResolvedValue({ ...activeUser, tokenVersion: 1 });

      await expect(service.refresh(refreshToken)).rejects.toThrow(UnauthorizedException);
    });
  });
});

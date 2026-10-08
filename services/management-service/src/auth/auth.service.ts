import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WithId } from 'mongodb';
import { ErrorCode } from '../common/errors/error-codes';
import { withId } from '../common/mongo/with-id.util';
import { UsersRepository } from '../identity/users.repository';
import { UserDocument, UserRole } from '../identity/user.schema';
import { JwtSigner } from './jwt.util';
import { verifyPassword } from './password.util';

type AuthenticatedUser = WithId<UserDocument>;

export interface PublicUser {
  id: string;
  workspaceId: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

/** Never return passwordHash/tokenVersion to a client - this is the
 * one place a UserDocument is turned into a response body. */
function toPublicUser(user: AuthenticatedUser): PublicUser {
  const { passwordHash: _passwordHash, tokenVersion: _tokenVersion, createdAt: _createdAt, ...rest } =
    withId(user);
  return rest;
}

@Injectable()
export class AuthService {
  private readonly jwtSigner: JwtSigner;

  constructor(
    private readonly usersRepository: UsersRepository,
    config: ConfigService,
  ) {
    this.jwtSigner = new JwtSigner(config);
  }

  private invalidCredentials(): never {
    // Deliberately the SAME message/code whether the email is unknown
    // or the password is wrong - distinguishing the two lets an
    // attacker enumerate real emails. Never logged with the attempted
    // password either (see auth.controller.ts).
    throw new UnauthorizedException({
      code: ErrorCode.UNAUTHENTICATED,
      message: 'Invalid email or password.',
    });
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.usersRepository.findByEmailAnyWorkspace(email.trim().toLowerCase());
    if (!user || !user.active) {
      this.invalidCredentials();
    }

    const passwordMatches = await verifyPassword(password, user.passwordHash);
    if (!passwordMatches) {
      this.invalidCredentials();
    }

    return this.issueTokens(user);
  }

  async refresh(refreshToken: string | undefined): Promise<AuthResult> {
    if (!refreshToken) {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHENTICATED,
        message: 'No refresh token provided.',
      });
    }

    let payload;
    try {
      payload = this.jwtSigner.verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Invalid or expired refresh token.',
      });
    }

    const user = await this.usersRepository.findById(payload.workspaceId, payload.sub);
    if (!user || !user.active || user.tokenVersion !== payload.tokenVersion) {
      // tokenVersion mismatch covers both logout (incremented on
      // purpose) and a stolen/replayed older refresh token - either
      // way, the right answer is the same: reject it.
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Invalid or expired refresh token.',
      });
    }

    return this.issueTokens(user);
  }

  async logout(workspaceId: string, userId: string): Promise<void> {
    await this.usersRepository.incrementTokenVersion(workspaceId, userId);
  }

  private issueTokens(user: AuthenticatedUser): AuthResult {
    const userId = user._id.toHexString();
    const accessToken = this.jwtSigner.signAccessToken({
      sub: userId,
      workspaceId: user.workspaceId,
      role: user.role,
    });
    const refreshToken = this.jwtSigner.signRefreshToken({
      sub: userId,
      workspaceId: user.workspaceId,
      tokenVersion: user.tokenVersion,
    });
    return { accessToken, refreshToken, user: toPublicUser(user) };
  }

  get refreshCookieMaxAgeMs(): number {
    return this.jwtSigner.refreshTtlMs;
  }
}

import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { UserRole } from '../identity/user.schema';

const DEFAULT_ACCESS_TOKEN_TTL = '15m';
const DEFAULT_REFRESH_TOKEN_TTL = '7d';

export interface AccessTokenPayload {
  sub: string;
  workspaceId: string;
  role: UserRole;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  workspaceId: string;
  tokenVersion: number;
  type: 'refresh';
}

/** Same pattern as database.providers.ts/nats-connection.service.ts's
 * own `requireEnv` - secrets come from the environment only, never a
 * hardcoded fallback, and the app fails fast at the point of first
 * use rather than silently signing tokens with an empty string. */
function requireEnv(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export class JwtSigner {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessTtl: string;
  private readonly refreshTtl: string;

  constructor(config: ConfigService) {
    this.accessSecret = requireEnv(config, 'JWT_SECRET');
    this.refreshSecret = requireEnv(config, 'JWT_REFRESH_SECRET');
    this.accessTtl = config.get<string>('JWT_ACCESS_TOKEN_TTL') ?? DEFAULT_ACCESS_TOKEN_TTL;
    this.refreshTtl = config.get<string>('JWT_REFRESH_TOKEN_TTL') ?? DEFAULT_REFRESH_TOKEN_TTL;
  }

  signAccessToken(payload: Omit<AccessTokenPayload, 'type'>): string {
    const body: AccessTokenPayload = { ...payload, type: 'access' };
    return jwt.sign(body, this.accessSecret, { expiresIn: this.accessTtl } as jwt.SignOptions);
  }

  signRefreshToken(payload: Omit<RefreshTokenPayload, 'type'>): string {
    const body: RefreshTokenPayload = { ...payload, type: 'refresh' };
    return jwt.sign(body, this.refreshSecret, { expiresIn: this.refreshTtl } as jwt.SignOptions);
  }

  /** Throws (jwt.verify's own error types - TokenExpiredError,
   * JsonWebTokenError, etc.) on an invalid/expired/wrong-secret token.
   * Callers map that to 401, never leaking the raw error to a client -
   * see RequestContextGuard/AuthController. */
  verifyAccessToken(token: string): AccessTokenPayload {
    const decoded = jwt.verify(token, this.accessSecret) as AccessTokenPayload;
    if (decoded.type !== 'access') {
      throw new Error('Not an access token.');
    }
    return decoded;
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    const decoded = jwt.verify(token, this.refreshSecret) as RefreshTokenPayload;
    if (decoded.type !== 'refresh') {
      throw new Error('Not a refresh token.');
    }
    return decoded;
  }

  /** Milliseconds until the refresh token expires - used to set the
   * HttpOnly cookie's own maxAge so the cookie never outlives the
   * token it carries. */
  get refreshTtlMs(): number {
    return parseDurationMs(this.refreshTtl);
  }
}

/** Parses the same simple `<number><unit>` duration strings
 * jsonwebtoken's `expiresIn` accepts (e.g. "15m", "7d") into
 * milliseconds - just enough to size the refresh cookie's maxAge from
 * the same JWT_REFRESH_TOKEN_TTL value, without a second config
 * entry that could drift out of sync with it. */
export function parseDurationMs(duration: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(duration.trim());
  if (!match) {
    throw new Error(`Invalid duration "${duration}" - expected e.g. "15m", "7d".`);
  }
  const value = Number(match[1]);
  const unitMs: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * unitMs[match[2]];
}

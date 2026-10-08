import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Public } from '../common/context/public.decorator';
import { CurrentContext } from '../common/context/current-context.decorator';
import { RequestContext } from '../common/context/request-context';
import { UsersRepository } from '../identity/users.repository';
import { UnauthorizedException } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

const REFRESH_COOKIE_NAME = 'refresh_token';

/**
 * Four routes, exactly matching the assignment's required surface:
 * POST login/refresh/logout, GET me. Login/refresh/logout are
 * `@Public()` - they are what *establishes* or *clears* identity, so
 * none can require RequestContextGuard's own verified-token check
 * first (refresh in particular must work precisely when the access
 * token has already expired). `me` is deliberately NOT `@Public()` -
 * it is the one route whose entire purpose is "tell me who
 * RequestContextGuard decided I am," so it must go through that exact
 * same verification every other authenticated route does.
 */
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersRepository: UsersRepository,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto.email, dto.password);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    const result = await this.authService.refresh(cookieToken);
    // Rotated: a new refresh token replaces the old one on every use,
    // so a leaked-but-not-yet-used-again token has a shrinking window
    // of validity rather than being reusable for its entire lifetime.
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    // Idempotent and tolerant on purpose: logging out with an
    // already-expired/missing refresh token still clears the cookie
    // and reports success - there is nothing left to invalidate, and
    // a client should never be stuck unable to "log out" locally.
    if (cookieToken) {
      try {
        // refresh() already verifies the token and resolves the real
        // user - reuse that identity, never anything a request
        // header/body could claim to be.
        const { user } = await this.authService.refresh(cookieToken);
        await this.authService.logout(user.workspaceId, user.id);
      } catch {
        // Already invalid/expired - nothing to invalidate server-side.
      }
    }
    this.clearRefreshCookie(res);
  }

  @Get('me')
  async me(@CurrentContext() ctx: RequestContext) {
    const user = await this.usersRepository.findById(ctx.workspaceId, ctx.userId);
    if (!user) {
      // Guarded against by RequestContextGuard already (it would have
      // 401'd), but never trust that invariant silently - a client
      // calling /me for a user that vanished between the guard and
      // here (e.g. deleted mid-request) gets a clean 401, not a crash.
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHENTICATED, message: 'Unknown user.' });
    }
    return {
      id: ctx.userId,
      workspaceId: ctx.workspaceId,
      role: ctx.role,
      name: user.name,
      email: user.email,
      active: user.active,
    };
  }

  private setRefreshCookie(res: Response, token: string): void {
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProd,
      // Cross-origin by design (admin-ui and management-service are
      // served from different hosts in both dev - different localhost
      // ports, same registrable "site" so Lax still works - and
      // production - different Railway subdomains, a genuinely
      // different site, which requires None+Secure to be sent at
      // all). See docs/DECISIONS.md for the full reasoning.
      sameSite: isProd ? 'none' : 'lax',
      path: '/api/auth',
      maxAge: this.authService.refreshCookieMaxAgeMs,
    });
  }

  private clearRefreshCookie(res: Response): void {
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/api/auth',
    });
  }
}

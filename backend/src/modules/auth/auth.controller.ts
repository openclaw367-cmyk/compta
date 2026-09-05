import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService, IssuedTokens } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_PATH = '/auth';
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * `/auth/*` — deliberately never in AuthMiddleware/CompanyContextMiddleware's
 * `forRoutes(...)` allowlist in app.module.ts (login/signup/refresh must
 * work with no prior identity or company context). See CLAUDE.md
 * "Multi-user / roles & permissions".
 *
 * The refresh token is the one secret this API hands the browser as a
 * cookie rather than a JSON field — httpOnly (invisible to JS, so an XSS
 * bug can't read it), SameSite=Lax, Secure gated on NODE_ENV==='production'
 * (Vite dev is plain HTTP; Secure cookies are silently dropped there —
 * a real, documented dev-vs-prod difference, not an oversight), and
 * path-scoped to /auth so it's never sent on ordinary API calls.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({
    summary: "Create an account and that user's first company (the caller becomes its OWNER).",
  })
  @Post('signup')
  async signup(@Body() dto: SignupDto, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.authService.signup(dto);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken, user: tokens.user };
  }

  @ApiOperation({ summary: 'Sign in with email + password.' })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.authService.login(dto);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken, user: tokens.user };
  }

  @ApiOperation({
    summary: 'Exchange the refresh-token cookie for a new access token (silent session refresh).',
  })
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    if (!rawToken) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
      return { accessToken: null, user: null };
    }
    let tokens: IssuedTokens;
    try {
      tokens = await this.authService.refresh(rawToken);
    } catch (error) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
      throw error;
    }
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken, user: tokens.user };
  }

  @ApiOperation({ summary: 'Revoke the current refresh token and clear its cookie.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const rawToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
    await this.authService.logout(rawToken);
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  }

  @ApiOperation({
    summary: 'Request a password-reset email.',
    description:
      'Always returns the same generic success response, whether or not the email has an ' +
      'account — never reveals account existence.',
  })
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    await this.authService.forgotPassword(dto.email);
    return {
      message: 'If an account exists for this email, a reset link has been sent.',
    };
  }

  @ApiOperation({ summary: 'Reset the password using the token from the reset email.' })
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password reset — you can now log in with your new password.' };
  }

  @ApiOperation({
    summary: 'Accept a company invite — creates an account if needed, then auto-logs-in.',
  })
  @Post('accept-invite')
  async acceptInvite(@Body() dto: AcceptInviteDto, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.authService.acceptInvite(dto);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken, user: tokens.user };
  }

  private setRefreshCookie(res: Response, rawToken: string): void {
    res.cookie(REFRESH_COOKIE_NAME, rawToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
  }
}

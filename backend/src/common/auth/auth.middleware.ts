import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { AccessTokenService } from './access-token.service';
import { RequestWithUser } from './request-with-user';

/**
 * Verifies the `Authorization: Bearer <jwt>` access token and attaches
 * `req.user = {id, email}` — see CLAUDE.md "Multi-user / roles &
 * permissions". No DB hit: the JWT's own claims are self-contained, kept
 * deliberately cheap since this runs on every request to every
 * company-scoped controller. There is no "guest" concept once this
 * ships — missing/invalid/expired token is always a 401, never a
 * silent pass-through. Runs BEFORE CompanyContextMiddleware in the same
 * `.apply(AuthMiddleware, CompanyContextMiddleware)` call in
 * app.module.ts, since company-membership resolution needs `req.user`
 * to already be set.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly accessTokens: AccessTokenService) {}

  use(req: RequestWithUser, _res: Response, next: NextFunction): void {
    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!token) {
      throw new UnauthorizedException('Missing Authorization: Bearer <token> header.');
    }
    const payload = this.accessTokens.verify(token);
    req.user = { id: payload.sub, email: payload.email };
    next();
  }
}

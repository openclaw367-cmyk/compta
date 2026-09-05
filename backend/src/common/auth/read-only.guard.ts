import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { RequestWithCompany } from '../tenant/request-with-company';

const SAFE_METHODS = new Set(['GET', 'HEAD']);

/**
 * The entire coarse "READ_ONLY can't write" rule, enforced ONCE — see
 * CLAUDE.md "Multi-user / roles & permissions". A guard, not more
 * middleware logic: guards are the idiomatic Nest layer for access
 * DECISIONS (middleware establishes context, e.g. CompanyContextMiddleware
 * resolving `req.companyContext.role`; guards decide whether the request
 * may proceed). Runs after all middleware, so `req.companyContext` is
 * already populated by the time this executes. Registered once, in
 * app.module.ts's providers as an APP_GUARD, covering the ENTIRE
 * existing controller surface with zero per-controller changes — this
 * is the actual payoff of choosing "coarse" over fine-grained
 * permissions this phase. OWNER-vs-MEMBER distinctions (e.g. only an
 * OWNER may manage members) are a separate, narrower check inside
 * MembershipsService, not this guard's concern.
 */
@Injectable()
export class ReadOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithCompany>();
    if (SAFE_METHODS.has(req.method)) {
      return true;
    }
    if (req.companyContext?.role === 'READ_ONLY') {
      throw new ForbiddenException(
        'This account has read-only access to this company and cannot make changes.',
      );
    }
    return true;
  }
}

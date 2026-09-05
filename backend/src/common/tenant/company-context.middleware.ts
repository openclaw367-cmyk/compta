import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RequestWithCompany } from './request-with-company';

const COMPANY_HEADER = 'x-company-id';

/**
 * Resolves the active company AND the caller's own access level for
 * every request, attaching both as `req.companyContext = {companyId,
 * role}` — so controllers/services never derive tenancy OR access
 * control ad hoc. See CLAUDE.md "Multi-user / roles & permissions".
 *
 * Runs AFTER AuthMiddleware (same `.apply(AuthMiddleware,
 * CompanyContextMiddleware)` call in app.module.ts) — `req.user` is
 * already set by the time this executes.
 *
 * The old "fall back to the single company in the DB" behavior is GONE,
 * deliberately, not just simplified: that fallback was safe only when
 * exactly one company could possibly exist for anyone asking. Once real
 * users/companies coexist, guessing "the" company would silently attach
 * a user with zero memberships to some OTHER user's only company — a
 * real access-control bug, not a convenience. The frontend has sent
 * `x-company-id` on every request since the company picker shipped
 * (see CLAUDE.md "Multi-tenant data model"), so requiring it outright
 * costs nothing in practice.
 */
@Injectable()
export class CompanyContextMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: RequestWithCompany, _res: Response, next: NextFunction): Promise<void> {
    const companyId = req.header(COMPANY_HEADER);
    if (!companyId) {
      throw new BadRequestException(`Missing required "${COMPANY_HEADER}" header.`);
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId_companyId: { userId: req.user.id, companyId } },
      select: { role: true },
    });
    if (!membership) {
      throw new ForbiddenException(`You are not a member of company ${companyId}.`);
    }

    req.companyContext = { companyId, role: membership.role };
    next();
  }
}

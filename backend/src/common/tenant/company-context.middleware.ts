import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RequestWithCompany } from './request-with-company';

const COMPANY_HEADER = 'x-company-id';

/**
 * Resolves the active company for every request and attaches it as
 * `req.companyContext`, so controllers never derive tenancy ad hoc.
 *
 * Today the frontend is single-company and never sends the
 * `x-company-id` header, so this falls back to "the" company. That
 * fallback is the *only* place in the codebase allowed to assume there is
 * exactly one company — once a company picker exists, the frontend starts
 * sending the header and this fallback becomes dead code, with no schema
 * or service changes required elsewhere.
 */
@Injectable()
export class CompanyContextMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: RequestWithCompany, _res: Response, next: NextFunction): Promise<void> {
    const headerCompanyId = req.header(COMPANY_HEADER);

    const companyId = headerCompanyId ?? (await this.resolveSingleCompanyId());

    if (!companyId) {
      throw new NotFoundException(
        'No company found. Create a Company before calling the API, or pass the ' +
          `"${COMPANY_HEADER}" header explicitly.`,
      );
    }

    req.companyContext = { companyId };
    next();
  }

  private async resolveSingleCompanyId(): Promise<string | undefined> {
    const company = await this.prisma.company.findFirst({
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return company?.id;
  }
}

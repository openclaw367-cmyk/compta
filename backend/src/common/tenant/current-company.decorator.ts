import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CompanyContext } from './company-context';
import { RequestWithCompany } from './request-with-company';

/**
 * Injects the resolved CompanyContext into a controller method, e.g.
 * `findAll(@CurrentCompany() company: CompanyContext)`. The controller
 * passes it straight through to the service — it never reads
 * `req.companyContext` itself.
 */
export const CurrentCompany = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CompanyContext => {
    const req = ctx.switchToHttp().getRequest<RequestWithCompany>();
    return req.companyContext;
  },
);

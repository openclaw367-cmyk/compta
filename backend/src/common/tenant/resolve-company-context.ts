import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyContext } from './company-context';

/**
 * The membership lookup `CompanyContextMiddleware` runs for every HTTP
 * request, extracted so a second, non-HTTP caller (the local MCP server
 * — see `src/mcp-server/`) can resolve the IDENTICAL `{companyId, role}`
 * via the SAME real Membership check, never a parallel/looser one. The
 * middleware's own "missing x-company-id header" guard stays HTTP-
 * specific and is NOT part of this helper — an MCP connection gets its
 * target company from a startup argument, not a header, so there is no
 * header to be missing.
 */
export async function resolveCompanyContextForUser(
  prisma: PrismaService,
  userId: string,
  companyId: string,
): Promise<CompanyContext> {
  const membership = await prisma.membership.findUnique({
    where: { userId_companyId: { userId, companyId } },
    select: { role: true },
  });
  if (!membership) {
    throw new ForbiddenException(`You are not a member of company ${companyId}.`);
  }
  return { companyId, role: membership.role };
}

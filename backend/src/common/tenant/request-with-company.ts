import { RequestWithUser } from '../auth/request-with-user';
import { CompanyContext } from './company-context';

/**
 * Extends RequestWithUser (not the bare Express Request) — resolving a
 * CompanyContext requires knowing WHO is asking (see CompanyContextMiddleware,
 * which runs after AuthMiddleware and reads req.user.id to look up the
 * caller's Membership).
 */
export interface RequestWithCompany extends RequestWithUser {
  companyContext: CompanyContext;
}

import { MembershipRole } from '@prisma/client';

/**
 * The tenant context passed explicitly into every domain service call.
 * Services must accept this rather than reading an ambient global, so the
 * exact same service code keeps working once the UI grows a company
 * picker. See CLAUDE.md "Multi-tenant data model".
 *
 * `role` (the caller's own Membership role for this company — see
 * CLAUDE.md "Multi-user / roles & permissions") is resolved by
 * CompanyContextMiddleware alongside companyId. Most services never need
 * to read it directly: the coarse READ_ONLY-blocks-writes rule is
 * enforced once, generically, by ReadOnlyGuard — this field exists on
 * the context mainly for that guard and for the rare service (e.g.
 * MembershipsService) that needs a finer OWNER-only check.
 */
export interface CompanyContext {
  companyId: string;
  role: MembershipRole;
}

/**
 * The tenant context passed explicitly into every domain service call.
 * Services must accept this rather than reading an ambient global, so the
 * exact same service code keeps working once the UI grows a company
 * picker. See CLAUDE.md "Multi-tenant data model".
 */
export interface CompanyContext {
  companyId: string;
}

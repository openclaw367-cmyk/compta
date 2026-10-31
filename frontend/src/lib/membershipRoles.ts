import type { MembershipRole } from '../api/types';

/**
 * Shared role labels — extracted from MembersPage.tsx once CabinetPage.tsx
 * needed the same mapping too (this app's own "duplicate runtime code
 * within the frontend only until a second file needs it" discipline, see
 * CLAUDE.md "Dashboard").
 */
export const ROLE_LABEL: Record<MembershipRole, string> = {
  OWNER: 'Propriétaire',
  MEMBER: 'Membre',
  READ_ONLY: 'Lecture seule',
};

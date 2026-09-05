import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

/**
 * Shared by seed.ts/seed-monaco.ts — see CLAUDE.md "Multi-user / roles &
 * permissions". Once auth ships, every seeded demo company would
 * otherwise be ownerless (no User/Membership rows point at them),
 * unreachable by anyone signing up fresh. This bootstraps one obviously
 * fake, dev-only admin account and grants it OWNER on whichever company
 * is passed in — idempotent (safe to call from multiple seed scripts, or
 * re-run the same seed script, without creating duplicates).
 *
 * Credentials are deliberately fixed and printed to the console, never
 * meant to be a real secret — this is local dev bootstrap data, not
 * production seed data (this app has no deployed production instance
 * yet, per CLAUDE.md).
 */
export const DEV_ADMIN_EMAIL = 'admin@compta.local';
export const DEV_ADMIN_PASSWORD = 'admin1234';

export async function ensureDevAdminMembership(prisma: PrismaClient, companyId: string) {
  const passwordHash = await bcrypt.hash(DEV_ADMIN_PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email: DEV_ADMIN_EMAIL },
    update: {},
    create: { email: DEV_ADMIN_EMAIL, passwordHash },
  });
  await prisma.membership.upsert({
    where: { userId_companyId: { userId: user.id, companyId } },
    update: { role: 'OWNER' },
    create: { userId: user.id, companyId, role: 'OWNER' },
  });
  console.log(`Dev admin: ${DEV_ADMIN_EMAIL} / ${DEV_ADMIN_PASSWORD} (OWNER on ${companyId})`);
}

import { PrismaClient } from '@prisma/client';
import { JOURNALS, PCG_ACCOUNTS } from './pcg-accounts';

const prisma = new PrismaClient();

/**
 * Monaco demo company, separate from the FR demo company seeded by
 * seed.ts (never modified by this script). Same base chart of accounts
 * and journals as the FR company — see pcg-accounts.ts for why the VAT
 * accounts (445660/445662/445710) are reused identically rather than
 * given a parallel Monaco-specific numbering: they're company-scoped, so
 * there's no collision, and the underlying PCG category is confirmed
 * identical (specs/vat-monaco-implementation-spec.md §4a — Monaco's
 * ligne 44/45 labels are verbatim identical to France's ligne 19/20).
 *
 * jurisdiction: 'MC' is what selects this company onto the (not yet
 * built) Monaco declaration path in VatService.computeDeclaration() —
 * see the jurisdiction guard added there.
 *
 * No VatRate rows are seeded here, deliberately mirroring seed.ts (which
 * doesn't seed any either) — a rate-tagged hand-check dataset is later
 * work, the same shape as seed-sample.ts's SAMPLE_VAT_RATES, once
 * computeMonacoDeclaration() exists to verify against.
 */

const DEMO_FISCAL_YEAR = {
  label: '2026',
  startDate: new Date(Date.UTC(2026, 0, 1)),
  endDate: new Date(Date.UTC(2026, 11, 31)),
};

async function findOrCreateMonacoDemoCompany() {
  const existing = await prisma.company.findFirst({ where: { jurisdiction: 'MC' } });
  if (existing) {
    return existing;
  }
  return prisma.company.create({
    data: {
      name: 'Société Démo Monaco SARL',
      jurisdiction: 'MC',
      rci: '26S06789', // placeholder RCI (Registre du Commerce et de l'Industrie), not sourced from real data
      addressLine: '7 Avenue des Citronniers',
      postalCode: '98000',
      city: 'Monaco',
      country: 'Monaco',
    },
  });
}

async function main(): Promise<void> {
  const company = await findOrCreateMonacoDemoCompany();
  console.log(`Company: ${company.name} (${company.id})`);

  const fiscalYear = await prisma.fiscalYear.upsert({
    where: { companyId_label: { companyId: company.id, label: DEMO_FISCAL_YEAR.label } },
    update: {},
    create: { companyId: company.id, ...DEMO_FISCAL_YEAR },
  });
  console.log(`Fiscal year: ${fiscalYear.label} (${fiscalYear.startDate.toISOString().slice(0, 10)} — ${fiscalYear.endDate.toISOString().slice(0, 10)})`);

  for (const account of PCG_ACCOUNTS) {
    await prisma.account.upsert({
      where: { companyId_number: { companyId: company.id, number: account.number } },
      update: { label: account.label },
      create: {
        companyId: company.id,
        number: account.number,
        label: account.label,
        pcgClass: Number(account.number.charAt(0)),
      },
    });
  }
  console.log(`Chart of accounts: ${PCG_ACCOUNTS.length} accounts (classes 1-7)`);

  for (const journal of JOURNALS) {
    await prisma.journal.upsert({
      where: { companyId_code: { companyId: company.id, code: journal.code } },
      update: { label: journal.label, type: journal.type },
      create: { companyId: company.id, code: journal.code, label: journal.label, type: journal.type },
    });
  }
  console.log(`Journals: ${JOURNALS.map((j) => j.code).join(', ')}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

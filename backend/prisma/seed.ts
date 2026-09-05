import { PrismaClient } from '@prisma/client';
import { JOURNALS, PCG_ACCOUNTS } from '../src/common/pcg/pcg-accounts';
import { ensureDevAdminMembership } from './seed-dev-admin';

const prisma = new PrismaClient();

const DEMO_FISCAL_YEAR = {
  label: '2026',
  startDate: new Date(Date.UTC(2026, 0, 1)),
  endDate: new Date(Date.UTC(2026, 11, 31)),
};

async function findOrCreateDemoCompany() {
  const existing = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) {
    return existing;
  }
  return prisma.company.create({
    data: {
      name: 'Société Démo SARL',
      jurisdiction: 'FR',
      siren: '123456789',
      vatNumber: 'FR12123456789',
    },
  });
}

async function main(): Promise<void> {
  const company = await findOrCreateDemoCompany();
  console.log(`Company: ${company.name} (${company.id})`);

  const fiscalYear = await prisma.fiscalYear.upsert({
    where: { companyId_label: { companyId: company.id, label: DEMO_FISCAL_YEAR.label } },
    update: {},
    create: { companyId: company.id, ...DEMO_FISCAL_YEAR },
  });
  console.log(
    `Fiscal year: ${fiscalYear.label} (${fiscalYear.startDate.toISOString().slice(0, 10)} — ${fiscalYear.endDate.toISOString().slice(0, 10)})`,
  );

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
      create: {
        companyId: company.id,
        code: journal.code,
        label: journal.label,
        type: journal.type,
      },
    });
  }
  console.log(`Journals: ${JOURNALS.map((j) => j.code).join(', ')}`);

  await ensureDevAdminMembership(prisma, company.id);
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

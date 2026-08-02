import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { EntriesService } from '../src/modules/entries/entries.service';
import { CompanyContext } from '../src/common/tenant/company-context';
import { CreateEcritureDto } from '../src/modules/entries/dto/create-ecriture.dto';

/**
 * Dev-only: posts and validates a realistic spread of sample écritures
 * across all five standard journals, through the real EntriesService (so
 * balance checking, sequential EcritureNum assignment, and immutability
 * all run exactly as they would via the API) — useful for exercising FEC
 * export and Swagger by hand without typing every entry in manually.
 *
 * Requires `npm run seed` to have already run (needs the demo company, its
 * 2026 fiscal year, the standard journals, and the accounts referenced
 * below).
 *
 * Idempotent: each écriture is tagged with a "SAMPLE-..." PieceRef and
 * skipped on a re-run if an écriture with that PieceRef already exists;
 * the reversal is skipped if the original already has a reversal. VAT
 * rates are found-or-created by (label, ratePercent), same idea.
 *
 * The original SAMPLE-VE-0001/0002 sales lines are deliberately left
 * untagged (no vatRateId) — they predate the CA3 declaration work and
 * exist to demonstrate computeCa3Declaration()'s guard actually firing
 * on real historical data, not to be retagged into passing. The
 * April 2026 entries below are the properly-tagged CA3 hand-check
 * dataset — see the comment above SAMPLE_VAT_RATES for the expected
 * result.
 */

const FISCAL_YEAR_LABEL = '2026';
const JOURNAL_CODES = ['AC', 'VE', 'BQ', 'OD', 'AN'];

/** EcritureLet marker linking SAMPLE-VE-0001 (invoice) and SAMPLE-BQ-0001 (payment). */
const LETTRAGE_CODE = 'A1';
const LETTRAGE_DATE = new Date('2026-02-20');

const REVERSED_PIECE_REF = 'SAMPLE-OD-0001';

interface SampleLigne {
  compteNumber: string;
  debit?: string;
  credit?: string;
  lettrage?: string;
  /** References SAMPLE_VAT_RATES by label — only set on collectée/revenue lines that need a rate. */
  vatRateLabel?: string;
}

/**
 * CA3 hand-check dataset (April 2026 — POST /vat/declaration with
 * periodStart "2026-04-01", periodEnd "2026-04-30"):
 *
 *   Collectée   08 (20%)  base 1000.00  taxe 200.00
 *               9B (10%)  base  500.00  taxe  50.00
 *               ligne 16 = 200.00 + 50.00 = 250.00
 *   Déductible  ligne 19 (immobilisations) = 90.00
 *               ligne 20 (autres biens et services) = 60.00
 *               ligne 23 = 90.00 + 60.00 = 150.00
 *   16 (250.00) > 23 (150.00) -> ligne TD (TVA due) = 100.00, ligne 25 = null.
 */
interface SampleVatRate {
  label: string;
  ratePercent: string;
  validFrom: string;
}

const SAMPLE_VAT_RATES: SampleVatRate[] = [
  { label: 'Taux normal', ratePercent: '20.00', validFrom: '2026-01-01' },
  { label: 'Taux réduit 10 %', ratePercent: '10.00', validFrom: '2026-01-01' },
];

interface SampleEcriture {
  journalCode: string;
  pieceRef: string;
  ecritureDate: string;
  libelle: string;
  lignes: SampleLigne[];
}

const SAMPLE_ECRITURES: SampleEcriture[] = [
  // AC — achats
  {
    journalCode: 'AC',
    pieceRef: 'SAMPLE-AC-0001',
    ecritureDate: '2026-02-05',
    libelle: 'Achat marchandises - Fournisseur Dupont',
    lignes: [
      { compteNumber: '607000', debit: '1000.00' },
      { compteNumber: '445660', debit: '200.00' },
      { compteNumber: '401000', credit: '1200.00' },
    ],
  },
  {
    journalCode: 'AC',
    pieceRef: 'SAMPLE-AC-0002',
    ecritureDate: '2026-03-10',
    libelle: 'Achat marchandises - Fournisseur Martin',
    lignes: [
      { compteNumber: '607000', debit: '750.00' },
      { compteNumber: '445660', debit: '150.00' },
      { compteNumber: '401000', credit: '900.00' },
    ],
  },
  // AC — CA3 hand-check dataset (déductible side, see SAMPLE_VAT_RATES
  // comment above): no vatRateId needed, lignes 19/20 don't split by rate.
  {
    journalCode: 'AC',
    pieceRef: 'SAMPLE-AC-0003',
    ecritureDate: '2026-04-05',
    libelle: 'Achat immobilisation - Matériel informatique',
    lignes: [
      { compteNumber: '218300', debit: '450.00' },
      { compteNumber: '445662', debit: '90.00' },
      { compteNumber: '404000', credit: '540.00' },
    ],
  },
  {
    journalCode: 'AC',
    pieceRef: 'SAMPLE-AC-0004',
    ecritureDate: '2026-04-20',
    libelle: 'Achat fournitures - Fournisseur Dupont',
    lignes: [
      { compteNumber: '607000', debit: '300.00' },
      { compteNumber: '445660', debit: '60.00' },
      { compteNumber: '401000', credit: '360.00' },
    ],
  },
  // VE — ventes. SAMPLE-VE-0001's 411000 line is lettered with SAMPLE-BQ-0001 below.
  {
    journalCode: 'VE',
    pieceRef: 'SAMPLE-VE-0001',
    ecritureDate: '2026-02-10',
    libelle: 'Vente marchandises - Client Leroy',
    lignes: [
      { compteNumber: '411000', debit: '2400.00', lettrage: LETTRAGE_CODE },
      { compteNumber: '707000', credit: '2000.00' },
      { compteNumber: '445710', credit: '400.00' },
    ],
  },
  {
    journalCode: 'VE',
    pieceRef: 'SAMPLE-VE-0002',
    ecritureDate: '2026-03-15',
    libelle: 'Vente marchandises - Client Petit',
    lignes: [
      { compteNumber: '411000', debit: '1800.00' },
      { compteNumber: '707000', credit: '1500.00' },
      { compteNumber: '445710', credit: '300.00' },
    ],
  },
  // VE — CA3 hand-check dataset (collectée side, see SAMPLE_VAT_RATES
  // comment above): both the revenue line and the TVA line are tagged
  // with the same rate, per the vatRateId design (one line-level tag
  // drives both the base-HT and the collectée aggregation).
  {
    journalCode: 'VE',
    pieceRef: 'SAMPLE-VE-0003',
    ecritureDate: '2026-04-10',
    libelle: 'Vente marchandises - Client Bernard (taux normal)',
    lignes: [
      { compteNumber: '411000', debit: '1200.00' },
      { compteNumber: '707000', credit: '1000.00', vatRateLabel: 'Taux normal' },
      { compteNumber: '445710', credit: '200.00', vatRateLabel: 'Taux normal' },
    ],
  },
  {
    journalCode: 'VE',
    pieceRef: 'SAMPLE-VE-0004',
    ecritureDate: '2026-04-15',
    libelle: 'Vente marchandises - Client Rousseau (taux réduit 10 %)',
    lignes: [
      { compteNumber: '411000', debit: '550.00' },
      { compteNumber: '707000', credit: '500.00', vatRateLabel: 'Taux réduit 10 %' },
      { compteNumber: '445710', credit: '50.00', vatRateLabel: 'Taux réduit 10 %' },
    ],
  },
  // BQ — banque. SAMPLE-BQ-0001 settles SAMPLE-VE-0001 — the lettered pair.
  {
    journalCode: 'BQ',
    pieceRef: 'SAMPLE-BQ-0001',
    ecritureDate: '2026-02-20',
    libelle: 'Règlement client Leroy - facture SAMPLE-VE-0001',
    lignes: [
      { compteNumber: '512000', debit: '2400.00' },
      { compteNumber: '411000', credit: '2400.00', lettrage: LETTRAGE_CODE },
    ],
  },
  {
    journalCode: 'BQ',
    pieceRef: 'SAMPLE-BQ-0002',
    ecritureDate: '2026-03-31',
    libelle: 'Frais bancaires trimestriels',
    lignes: [
      { compteNumber: '627000', debit: '45.00' },
      { compteNumber: '512000', credit: '45.00' },
    ],
  },
  // OD — opérations diverses. Reversed below (contre-passation).
  {
    journalCode: 'OD',
    pieceRef: REVERSED_PIECE_REF,
    ecritureDate: '2026-03-31',
    libelle: 'Charges à payer - salaires mars',
    lignes: [
      { compteNumber: '641000', debit: '3000.00' },
      { compteNumber: '421000', credit: '3000.00' },
    ],
  },
  // AN — à-nouveaux
  {
    journalCode: 'AN',
    pieceRef: 'SAMPLE-AN-0001',
    ecritureDate: '2026-01-01',
    libelle: "À-nouveaux - solde d'ouverture",
    lignes: [
      { compteNumber: '512000', debit: '15000.00' },
      { compteNumber: '101000', credit: '15000.00' },
    ],
  },
];

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const prisma = app.get(PrismaService);
    const entriesService = app.get(EntriesService);

    const company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!company) {
      throw new Error('No company found — run `npm run seed` first.');
    }
    const companyContext: CompanyContext = { companyId: company.id };

    const fiscalYear = await prisma.fiscalYear.findFirst({
      where: { companyId: company.id, label: FISCAL_YEAR_LABEL },
    });
    if (!fiscalYear) {
      throw new Error(`No fiscal year "${FISCAL_YEAR_LABEL}" found — run \`npm run seed\` first.`);
    }

    const journals = await prisma.journal.findMany({
      where: { companyId: company.id, code: { in: JOURNAL_CODES } },
    });
    const journalIdByCode = new Map(journals.map((journal) => [journal.code, journal.id]));
    for (const code of JOURNAL_CODES) {
      if (!journalIdByCode.has(code)) {
        throw new Error(`Journal "${code}" not found — run \`npm run seed\` first.`);
      }
    }

    const accountNumbers = Array.from(
      new Set(SAMPLE_ECRITURES.flatMap((ecriture) => ecriture.lignes.map((l) => l.compteNumber))),
    );
    const accounts = await prisma.account.findMany({
      where: { companyId: company.id, number: { in: accountNumbers } },
    });
    const accountIdByNumber = new Map(accounts.map((account) => [account.number, account.id]));
    for (const number of accountNumbers) {
      if (!accountIdByNumber.has(number)) {
        throw new Error(`Account "${number}" not found — run \`npm run seed\` first.`);
      }
    }

    const vatRateIdByLabel = new Map<string, string>();
    for (const rate of SAMPLE_VAT_RATES) {
      const existingRate = await prisma.vatRate.findFirst({
        where: { companyId: company.id, label: rate.label, ratePercent: rate.ratePercent },
      });
      if (existingRate) {
        vatRateIdByLabel.set(rate.label, existingRate.id);
        console.log(`VAT rate already exists: ${rate.label} (${rate.ratePercent}%)`);
        continue;
      }
      const created = await prisma.vatRate.create({
        data: {
          companyId: company.id,
          label: rate.label,
          ratePercent: rate.ratePercent,
          validFrom: new Date(rate.validFrom),
        },
      });
      vatRateIdByLabel.set(rate.label, created.id);
      console.log(`Created VAT rate: ${rate.label} (${rate.ratePercent}%)`);
    }

    const referencedVatRateLabels = Array.from(
      new Set(
        SAMPLE_ECRITURES.flatMap((ecriture) =>
          ecriture.lignes.map((l) => l.vatRateLabel).filter((label): label is string => Boolean(label)),
        ),
      ),
    );
    for (const label of referencedVatRateLabels) {
      if (!vatRateIdByLabel.has(label)) {
        throw new Error(`VAT rate "${label}" referenced by a sample line is not in SAMPLE_VAT_RATES.`);
      }
    }

    let createdCount = 0;
    let skippedCount = 0;

    for (const spec of SAMPLE_ECRITURES) {
      const existing = await prisma.ecriture.findFirst({
        where: { companyId: company.id, pieceRef: spec.pieceRef },
      });
      if (existing) {
        skippedCount += 1;
        console.log(`Skipped (already exists): ${spec.pieceRef} - ${spec.libelle}`);
        continue;
      }

      const dto: CreateEcritureDto = {
        journalId: journalIdByCode.get(spec.journalCode)!,
        fiscalYearId: fiscalYear.id,
        ecritureDate: spec.ecritureDate,
        pieceRef: spec.pieceRef,
        pieceDate: spec.ecritureDate,
        libelle: spec.libelle,
        lignes: spec.lignes.map((ligne) => ({
          compteId: accountIdByNumber.get(ligne.compteNumber)!,
          debit: ligne.debit,
          credit: ligne.credit,
          lettrage: ligne.lettrage,
          vatRateId: ligne.vatRateLabel ? vatRateIdByLabel.get(ligne.vatRateLabel) : undefined,
        })),
      };

      const draft = await entriesService.create(companyContext, dto);
      const validated = await entriesService.validate(companyContext, draft.id);
      createdCount += 1;
      console.log(
        `Created + validated: ${spec.journalCode} ${validated.ecritureNum} - ${spec.pieceRef} - ${spec.libelle}`,
      );
    }

    // Lettrage itself is set on the lines above via
    // CreateEcritureLigneDto.lettrage; DateLet isn't exposed on that DTO
    // (there's no lettering endpoint yet), so it's backfilled directly here
    // to keep the sample data realistic — Article A47 A-1 pairs DateLet
    // with EcritureLet, it isn't left blank once EcritureLet is set.
    await prisma.ecritureLigne.updateMany({
      where: { companyId: company.id, lettrage: LETTRAGE_CODE },
      data: { dateLettrage: LETTRAGE_DATE },
    });

    const toReverse = await prisma.ecriture.findFirst({
      where: { companyId: company.id, pieceRef: REVERSED_PIECE_REF },
    });
    if (!toReverse) {
      throw new Error(`Expected to find "${REVERSED_PIECE_REF}" after seeding — internal error.`);
    }
    const alreadyReversed = await prisma.ecriture.findFirst({
      where: { companyId: company.id, reversesId: toReverse.id },
    });
    if (alreadyReversed) {
      skippedCount += 1;
      console.log(`Skipped (already reversed): ${REVERSED_PIECE_REF}`);
    } else {
      const reversal = await entriesService.reverse(companyContext, toReverse.id);
      const validatedReversal = await entriesService.validate(companyContext, reversal.id);
      createdCount += 1;
      console.log(
        `Created + validated reversal: ${validatedReversal.ecritureNum} - extourne of ${REVERSED_PIECE_REF}`,
      );
    }

    console.log(`\nDone. Created ${createdCount}, skipped ${skippedCount} (already present).`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

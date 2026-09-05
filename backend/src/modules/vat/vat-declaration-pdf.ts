import { Company } from '@prisma/client';
import { PdfReportBuilder, formatMoneyForPdf } from '../../common/pdf/pdf-report-renderer';
import { Ca3Declaration } from './ca3-declaration';
import { MonacoDeclaration } from './monaco-declaration';

const RATE_COLUMNS = [
  { header: 'Ligne', width: 45 },
  { header: 'Libellé', width: 220 },
  { header: 'Taux', width: 60, align: 'right' as const },
  { header: 'Base HT', width: 90, align: 'right' as const },
  { header: 'Taxe', width: 90, align: 'right' as const },
];

function moneyOrZero(value: string | null): string {
  return formatMoneyForPdf(value ?? '0.00');
}

function renderCa3(declaration: Ca3Declaration, builder: PdfReportBuilder): void {
  builder.addSectionTitle('TVA collectée par taux');
  builder.addTable(
    RATE_COLUMNS,
    declaration.collecteeByRate.map((line) => [
      line.ligne,
      line.label,
      `${line.ratePercent.replace('.', ',')} %`,
      formatMoneyForPdf(line.baseHT),
      formatMoneyForPdf(line.taxe),
    ]),
  );

  builder.addSectionTitle('Déclaration CA3');
  builder.addKeyValueTable([
    ['Ligne 16 — TVA brute due', formatMoneyForPdf(declaration.ligne16)],
    ['Ligne 19 — Biens constituant des immobilisations', formatMoneyForPdf(declaration.ligne19)],
    ['Ligne 20 — Autres biens et services', formatMoneyForPdf(declaration.ligne20)],
    ['Ligne 23 — Total TVA déductible', formatMoneyForPdf(declaration.ligne23)],
    ['Ligne 25 — Crédit de TVA', moneyOrZero(declaration.ligne25)],
    ['Ligne TD — TVA due', moneyOrZero(declaration.ligneTD)],
    ['Ligne 28 — TVA nette due', formatMoneyForPdf(declaration.ligne28)],
    ['Ligne 32 — Total à payer', formatMoneyForPdf(declaration.ligne32)],
  ]);
}

function renderMonaco(declaration: MonacoDeclaration, builder: PdfReportBuilder): void {
  builder.addSectionTitle('TVA collectée par taux');
  builder.addTable(
    RATE_COLUMNS,
    declaration.collecteeByRate.map((line) => [
      line.ligne,
      line.label,
      `${line.ratePercent.replace('.', ',')} %`,
      formatMoneyForPdf(line.baseHT),
      formatMoneyForPdf(line.taxe),
    ]),
  );

  builder.addSectionTitle('Déclaration DSF (Monaco)');
  builder.addKeyValueTable([
    ['Ligne B1 — Total TVA collectée', formatMoneyForPdf(declaration.ligneB1)],
    ['Ligne 44 — Biens constituant des immobilisations', formatMoneyForPdf(declaration.ligne44)],
    ['Ligne 45 — Autres biens et services', formatMoneyForPdf(declaration.ligne45)],
    ['Ligne B2 — Total TVA déductible', formatMoneyForPdf(declaration.ligneB2)],
    ['Ligne B3 — Crédit de TVA', moneyOrZero(declaration.ligneB3)],
    ['Ligne 48 — TVA nette due', moneyOrZero(declaration.ligne48)],
    ['Ligne 60 — Total à payer', formatMoneyForPdf(declaration.ligne60)],
  ]);
}

/**
 * CA3 (FR) / DSF (Monaco) VAT declaration PDF — see CLAUDE.md
 * "Reporting/export flexibility". Genuinely two different forms
 * (different line numbers, different tax authority — same "not
 * variants of one computation" discipline `VatService.computeDeclaration()`
 * itself states), so this dispatches on `company.jurisdiction` exactly
 * like that method does, rather than guessing from the declaration
 * shape. A pure function over the already-computed declaration result.
 */
export async function renderVatDeclarationPdf(
  declaration: Ca3Declaration | MonacoDeclaration,
  company: Company,
  periodStart: string,
  periodEnd: string,
): Promise<Uint8Array> {
  const title =
    company.jurisdiction === 'FR'
      ? `Déclaration de TVA (CA3) — ${company.name}`
      : `Déclaration de TVA (DSF) — ${company.name}`;
  const builder = await PdfReportBuilder.create(title);
  builder.addParagraph(`Période du ${periodStart} au ${periodEnd}`);

  if (company.jurisdiction === 'FR') {
    renderCa3(declaration as Ca3Declaration, builder);
  } else {
    renderMonaco(declaration as MonacoDeclaration, builder);
  }

  return builder.build();
}

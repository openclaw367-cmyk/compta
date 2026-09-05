import { Company, FiscalYear } from '@prisma/client';
import { PdfReportBuilder, formatMoneyForPdf } from '../../common/pdf/pdf-report-renderer';
import { ResultatFiscalResult } from './resultat-fiscal';

/**
 * Verbatim — same wording as the "load-bearing design fact" CLAUDE.md
 * "Détermination du résultat fiscal" names as the single most prominent
 * element on the live screen. An export that silently dropped this
 * would misrepresent the report's own stated discipline: it proves its
 * OWN arithmetic, never tax completeness.
 */
const HONESTY_BANNER =
  'Ce tableau se recoupe arithmétiquement — cela ne garantit pas que tous les retraitements ' +
  'fiscaux applicables ont été déclarés.';

const DECLARED_COLUMNS = [
  { header: 'Code', width: 50 },
  { header: 'Libellé', width: 340 },
  { header: 'Montant', width: 90, align: 'right' as const },
];

const CONFIRMABLE_COLUMNS = [
  { header: 'Code', width: 50 },
  { header: 'Libellé', width: 260 },
  { header: 'Suggéré', width: 85, align: 'right' as const },
  { header: 'Confirmé', width: 85, align: 'right' as const },
];

/**
 * Détermination du résultat fiscal (2058-A/2058-B cadre III) PDF — see
 * CLAUDE.md "Reporting/export flexibility". A pure function over the
 * already-computed `ResultatFiscalService.generate()` result.
 */
export async function renderResultatFiscalPdf(
  result: ResultatFiscalResult,
  company: Company,
  fiscalYear: FiscalYear,
): Promise<Uint8Array> {
  const builder = await PdfReportBuilder.create(
    `Détermination du résultat fiscal — ${company.name}`,
  );
  builder.addParagraph(`Exercice ${fiscalYear.label}`);
  builder.addParagraph(HONESTY_BANNER);

  builder.addSectionTitle('Résultat');
  builder.addKeyValueTable([
    ['Résultat comptable', formatMoneyForPdf(result.resultatComptable)],
    [result.impotSurLesSocietes.label, formatMoneyForPdf(result.impotSurLesSocietes.montant)],
  ]);

  builder.addSectionTitle('Réintégrations à confirmer (WJ, WG)');
  builder.addTable(
    CONFIRMABLE_COLUMNS,
    result.reintegrationsConfirmables.map((line) => [
      line.code,
      line.label,
      formatMoneyForPdf(line.suggested),
      formatMoneyForPdf(line.confirmed),
    ]),
  );

  builder.addSectionTitle('Réintégrations déclarées');
  builder.addTable(
    DECLARED_COLUMNS,
    result.reintegrationsDeclarees.map((line) => [
      line.code,
      line.label,
      formatMoneyForPdf(line.montant),
    ]),
  );
  builder.addKeyValueTable([
    ['Total réintégrations', formatMoneyForPdf(result.totalReintegrations)],
  ]);

  builder.addSectionTitle('Déductions déclarées');
  builder.addTable(
    DECLARED_COLUMNS,
    result.deductionsDeclarees.map((line) => [
      line.code,
      line.label,
      formatMoneyForPdf(line.montant),
    ]),
  );
  builder.addKeyValueTable([['Total déductions', formatMoneyForPdf(result.totalDeductions)]]);

  builder.addSectionTitle('Résultat fiscal');
  builder.addKeyValueTable([['Résultat fiscal', formatMoneyForPdf(result.resultatFiscal)]]);

  return builder.build();
}

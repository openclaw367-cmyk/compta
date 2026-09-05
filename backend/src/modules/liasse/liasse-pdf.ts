import { Company, FiscalYear } from '@prisma/client';
import {
  PdfColumn,
  PdfReportBuilder,
  formatMoneyForPdf,
} from '../../common/pdf/pdf-report-renderer';
import { LiasseResult, LiasseSimplifieResult } from './liasse.service';

const PAGE_CONTENT_WIDTH = 495.28; // A4 minus 2×50pt margins

/**
 * Every liasse tableau's own ligne shape is `{ code, label, ...money
 * fields }` — confirmed across Bilan2050, Bilan2033A, the two compte
 * de résultat variants, and Tableau2054/2055/2056's own interfaces.
 * One small generic helper covers all of them rather than repeating
 * near-identical table-column code 9 times.
 */
function ligneColumns(moneyHeaders: string[]): PdfColumn[] {
  const labelWidth = 260;
  const codeWidth = 45;
  const moneyWidth = (PAGE_CONTENT_WIDTH - labelWidth - codeWidth) / moneyHeaders.length;
  return [
    { header: 'Code', width: codeWidth },
    { header: 'Libellé', width: labelWidth },
    ...moneyHeaders.map((header) => ({ header, width: moneyWidth, align: 'right' as const })),
  ];
}

function ligneRows<T extends { code: string; label: string }>(
  lignes: T[],
  moneyKeys: (keyof T)[],
): string[][] {
  return lignes.map((l) => [
    l.code,
    l.label,
    ...moneyKeys.map((key) => formatMoneyForPdf((l[key] as string | null) ?? '0.00')),
  ]);
}

function renderReelNormal(result: LiasseResult, builder: PdfReportBuilder): void {
  builder.addSectionTitle('Bilan — Actif (2050)');
  builder.addTable(
    ligneColumns(['Brut', 'Amort.', 'Net']),
    ligneRows(result.bilan.actif, ['brut', 'amortissements', 'net']),
    [
      '',
      'Total actif',
      formatMoneyForPdf(result.bilan.totalActifBrut),
      formatMoneyForPdf(result.bilan.totalActifAmortissements),
      formatMoneyForPdf(result.bilan.totalActifNet),
    ],
  );

  builder.addSectionTitle('Bilan — Passif (2051)');
  builder.addTable(
    ligneColumns(['Montant']),
    [
      ...ligneRows(result.bilan.passif, ['montant']),
      ['DI', "Résultat de l'exercice", formatMoneyForPdf(result.bilan.resultatDeLExercice)],
    ],
    ['', 'Total passif', formatMoneyForPdf(result.bilan.totalPassif)],
  );

  builder.addSectionTitle('Compte de résultat (2052/2053)');
  builder.addTable(
    ligneColumns(['Montant']),
    ligneRows(result.compteResultat.lignes, ['montant']),
    ['', 'Résultat net', formatMoneyForPdf(result.compteResultat.beneficeOuPerte)],
  );

  builder.addSectionTitle('Tableau 2054 — Immobilisations');
  builder.addTable(
    ligneColumns(['Début', 'Acquisitions', 'Cessions', 'Fin']),
    result.tableau2054.lignes.map((l) => [
      l.code,
      l.label,
      formatMoneyForPdf(l.valeurBruteDebut),
      formatMoneyForPdf(l.acquisitions),
      formatMoneyForPdf(l.cessions),
      formatMoneyForPdf(l.valeurBruteFin),
    ]),
    ['', 'Total général', '', '', '', formatMoneyForPdf(result.tableau2054.totalGeneral)],
  );

  builder.addSectionTitle('Tableau 2055 — Amortissements');
  builder.addTable(
    ligneColumns(['Début', 'Dotations', 'Diminutions', 'Fin']),
    result.tableau2055.lignes.map((l) => [
      l.code,
      l.label,
      formatMoneyForPdf(l.montantDebut),
      formatMoneyForPdf(l.dotations),
      formatMoneyForPdf(l.diminutions),
      formatMoneyForPdf(l.montantFin),
    ]),
    ['', 'Total général', '', '', '', formatMoneyForPdf(result.tableau2055.totalGeneral)],
  );

  builder.addSectionTitle('Tableau 2056 — Provisions');
  builder.addTable(
    ligneColumns(['Début', 'Dotations', 'Reprises', 'Fin']),
    result.tableau2056.lignes.map((l) => [
      l.code,
      l.label,
      formatMoneyForPdf(l.montantDebut),
      formatMoneyForPdf(l.dotations),
      formatMoneyForPdf(l.reprises),
      formatMoneyForPdf(l.montantFin),
    ]),
    ['', 'Total général', '', '', '', formatMoneyForPdf(result.tableau2056.totalGeneral)],
  );

  builder.addSectionTitle('Tableau 2057 — Cadre A (créances)');
  builder.addTable(
    ligneColumns(['Montant brut', 'À 1 an au plus', "À plus d'un an"]),
    result.tableau2057.cadreA.map((l) => [
      l.code,
      l.label,
      formatMoneyForPdf(l.montantBrut),
      formatMoneyForPdf(l.aUnAnAuPlus),
      formatMoneyForPdf(l.aPlusDUnAn),
    ]),
    ['', 'Total créances', formatMoneyForPdf(result.tableau2057.totalCreances), '', ''],
  );
  builder.addSectionTitle('Tableau 2057 — Cadre B (dettes)');
  builder.addTable(
    ligneColumns(['Montant brut', 'À 1 an au plus', '1 à 5 ans', 'Plus de 5 ans']),
    result.tableau2057.cadreB.map((l) => [
      l.code,
      l.label,
      formatMoneyForPdf(l.montantBrut),
      formatMoneyForPdf(l.aUnAnAuPlus),
      formatMoneyForPdf(l.aPlusDUnAnEt5AnsAuPlus),
      formatMoneyForPdf(l.aPlusDe5Ans),
    ]),
    ['', 'Total dettes', formatMoneyForPdf(result.tableau2057.totalDettes), '', '', ''],
  );
  builder.addParagraph(result.tableau2057.maturityNote, 8);

  builder.addSectionTitle('Tableau 2059-A — Plus/moins-values');
  if (result.tableau2059.cadreA.length === 0) {
    builder.addParagraph(result.tableau2059.note);
  } else {
    builder.addTable(
      [
        { header: 'Compte', width: 70 },
        { header: 'Valeur origine', width: 140, align: 'right' },
        { header: 'Amortissements', width: 140, align: 'right' },
        { header: 'Valeur résiduelle', width: 145, align: 'right' },
      ],
      result.tableau2059.cadreA.map((l) => [
        l.accountNumber,
        formatMoneyForPdf(l.valeurOrigine),
        formatMoneyForPdf(l.amortissements),
        formatMoneyForPdf(l.valeurResiduelle),
      ]),
    );
    builder.addTable(
      [
        { header: 'Compte', width: 70 },
        { header: 'Prix de vente', width: 210, align: 'right' },
        { header: 'Plus/moins-value', width: 215, align: 'right' },
      ],
      result.tableau2059.cadreB.map((l) => [
        l.accountNumber,
        formatMoneyForPdf(l.prixDeVente),
        formatMoneyForPdf(l.plusOuMoinsValue),
      ]),
      ['', 'Total (non qualifié)', formatMoneyForPdf(result.tableau2059.totalNonQualifie)],
    );
    builder.addParagraph(result.tableau2059.note, 8);
  }
}

function renderReelSimplifie(result: LiasseSimplifieResult, builder: PdfReportBuilder): void {
  builder.addSectionTitle('Bilan simplifié — Actif (2033-A)');
  builder.addTable(
    ligneColumns(['Brut', 'Amort.', 'Net']),
    ligneRows(result.bilan.actif, ['brut', 'amortissements', 'net']),
    [
      '',
      'Total actif',
      formatMoneyForPdf(result.bilan.totalActifBrut),
      formatMoneyForPdf(result.bilan.totalActifAmortissements),
      formatMoneyForPdf(result.bilan.totalActifNet),
    ],
  );

  builder.addSectionTitle('Bilan simplifié — Passif (2033-A)');
  builder.addTable(
    ligneColumns(['Montant']),
    [
      ...ligneRows(result.bilan.passif, ['montant']),
      ['', "Résultat de l'exercice", formatMoneyForPdf(result.bilan.resultatDeLExercice)],
    ],
    ['', 'Total passif', formatMoneyForPdf(result.bilan.totalPassif)],
  );

  builder.addSectionTitle('Compte de résultat simplifié (2033-B)');
  builder.addTable(
    ligneColumns(['Montant']),
    ligneRows(result.compteResultat.lignes, ['montant']),
    ['', 'Résultat net', formatMoneyForPdf(result.compteResultat.beneficeOuPerte)],
  );
}

/**
 * Liasse fiscale PDF — see CLAUDE.md "Reporting/export flexibility".
 * Branches on `regime` exactly like `LiassePage.tsx` already does: 7
 * sections for RÉEL_NORMAL, 2 for RÉEL_SIMPLIFIE. Each tableau's rows
 * render in the order the backend already returns them (CERFA form
 * order) — the frontend's own extra visual sub-groupings
 * (`TABLEAU_2054_SECTIONS` etc.) are interactive-screen polish, not
 * reproduced here, a stated simplification. A pure function over the
 * already-computed `LiasseService.generate()` result.
 */
export async function renderLiassePdf(
  result: LiasseResult | LiasseSimplifieResult,
  company: Company,
  fiscalYear: FiscalYear,
): Promise<Uint8Array> {
  const builder = await PdfReportBuilder.create(`Liasse fiscale — ${company.name}`);
  builder.addParagraph(
    `Exercice ${fiscalYear.label} — régime ${
      result.regime === 'REEL_NORMAL' ? 'réel normal' : 'réel simplifié'
    }`,
  );

  if (result.regime === 'REEL_NORMAL') {
    renderReelNormal(result, builder);
  } else {
    renderReelSimplifie(result, builder);
  }

  return builder.build();
}

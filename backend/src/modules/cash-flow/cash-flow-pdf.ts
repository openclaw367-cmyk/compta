import { Company, FiscalYear } from '@prisma/client';
import { PdfReportBuilder, formatMoneyForPdf } from '../../common/pdf/pdf-report-renderer';
import {
  CashFlowStatement,
  FluxExploitation,
  FluxFinancement,
  FluxInvestissement,
} from './cash-flow-statement';

/** Field key → French label, in print order — mirrors the labels CashFlowPage.tsx already uses. */
const EXPLOITATION_LABELS: [keyof FluxExploitation, string][] = [
  ['resultatNet', 'Résultat net'],
  ['dotationsAmortissementsProvisions', 'Dotations aux amortissements et provisions'],
  ['reprisesAmortissementsProvisions', 'Reprises sur amortissements et provisions'],
  ['valeurComptableElementsCedes', "Valeur comptable des éléments d'actifs cédés"],
  ['produitsDesCessions', "Produits des cessions d'éléments d'actif"],
  ['capaciteAutofinancement', "Capacité d'autofinancement (CAF)"],
  ['variationCreancesClients', 'Variation des créances clients'],
  ['variationStocks', 'Variation des stocks'],
  ['variationTvaDeductibleAutres', 'Variation TVA déductible sur autres biens et services'],
  ['variationDettesExploitation', "Variation des dettes d'exploitation"],
  ['total', "Total flux de trésorerie d'exploitation"],
];

const INVESTISSEMENT_LABELS: [keyof FluxInvestissement, string][] = [
  ['acquisitionsImmobilisations', "Acquisitions d'immobilisations"],
  ['variationTvaDeductibleImmobilisations', 'Variation TVA déductible sur immobilisations'],
  ['variationDettesSurImmobilisations', 'Variation des dettes sur immobilisations'],
  ['cessionsImmobilisations', "Cessions d'immobilisations"],
  ['variationCreancesSurCessions', 'Variation des créances sur cessions'],
  ['total', "Total flux de trésorerie d'investissement"],
];

const FINANCEMENT_LABELS: [keyof FluxFinancement, string][] = [
  ['variationEmprunts', 'Variation des emprunts'],
  ['variationCapital', 'Variation de capital'],
  ['variationComptesCourantsAssocies', "Variation des comptes courants d'associés"],
  ['distributions', 'Distributions'],
  ['total', 'Total flux de trésorerie de financement'],
];

function keyValueRows<T>(data: T, labels: [keyof T, string][]): [string, string][] {
  return labels.map(([key, label]) => [label, formatMoneyForPdf(data[key] as string)]);
}

/**
 * Tableau des flux de trésorerie PDF — see CLAUDE.md "Reporting/export
 * flexibility". A pure function over the already-computed
 * `CashFlowService.generate()` result.
 */
export async function renderCashFlowPdf(
  statement: CashFlowStatement,
  company: Company,
  fiscalYear: FiscalYear,
): Promise<Uint8Array> {
  const builder = await PdfReportBuilder.create(`Tableau des flux de trésorerie — ${company.name}`);
  builder.addParagraph(`Exercice ${fiscalYear.label}`);

  builder.addSectionTitle("Flux de trésorerie d'exploitation");
  builder.addKeyValueTable(keyValueRows(statement.fluxExploitation, EXPLOITATION_LABELS));

  builder.addSectionTitle("Flux de trésorerie d'investissement");
  builder.addKeyValueTable(keyValueRows(statement.fluxInvestissement, INVESTISSEMENT_LABELS));

  builder.addSectionTitle('Flux de trésorerie de financement');
  builder.addKeyValueTable(keyValueRows(statement.fluxFinancement, FINANCEMENT_LABELS));

  builder.addSectionTitle('Réconciliation');
  builder.addKeyValueTable([
    ['Variation de trésorerie', formatMoneyForPdf(statement.variationTresorerie)],
    ['Trésorerie à l’ouverture', formatMoneyForPdf(statement.tresorerieOuverture)],
    ['Trésorerie à la clôture', formatMoneyForPdf(statement.tresorerieCloture)],
  ]);

  return builder.build();
}

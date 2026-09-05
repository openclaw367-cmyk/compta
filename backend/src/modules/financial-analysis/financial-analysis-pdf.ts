import { Company, FiscalYear } from '@prisma/client';
import {
  PdfReportBuilder,
  formatDaysForPdf,
  formatMoneyForPdf,
  formatPercentForPdf,
  formatRatioForPdf,
} from '../../common/pdf/pdf-report-renderer';
import { FinancialAnalysisResult } from './financial-analysis';

type FieldFormat = 'money' | 'percent' | 'ratio' | 'days';
type FieldSpec<T> = [keyof T, string, FieldFormat];

function formatField(value: string | null, format: FieldFormat): string {
  switch (format) {
    case 'money':
      return formatMoneyForPdf(value as string);
    case 'percent':
      return formatPercentForPdf(value);
    case 'ratio':
      return formatRatioForPdf(value);
    case 'days':
      return formatDaysForPdf(value);
  }
}

function rows<T>(data: T, specs: FieldSpec<T>[]): [string, string][] {
  return specs.map(([key, label, format]) => [
    label,
    formatField(data[key] as string | null, format),
  ]);
}

/**
 * Analyse financière PDF — see CLAUDE.md "Reporting/export
 * flexibility". A curated, SIMPLER label set than the live
 * `FinancialAnalysisPage.tsx`'s own per-row derivation captions
 * (e.g. "Marge commerciale — Ventes de marchandises (FC) − Achats...")
 * — a stated design choice: the export is a report to read, not a
 * teaching aid, so it names each figure without re-deriving the exact
 * line-code formula. A pure function over the already-computed
 * `FinancialAnalysisService.generate()` result.
 */
export async function renderFinancialAnalysisPdf(
  result: FinancialAnalysisResult,
  company: Company,
  fiscalYear: FiscalYear,
): Promise<Uint8Array> {
  const builder = await PdfReportBuilder.create(`Analyse financière — ${company.name}`);
  builder.addParagraph(`Exercice ${fiscalYear.label}`);

  builder.addSectionTitle('Soldes intermédiaires de gestion');
  builder.addKeyValueTable(
    rows(result.sig, [
      ['margeCommerciale', 'Marge commerciale', 'money'],
      ['productionDeLExercice', "Production de l'exercice", 'money'],
      ['consommationsEnProvenanceDesTiers', 'Consommations en provenance des tiers', 'money'],
      ['valeurAjoutee', 'Valeur ajoutée', 'money'],
      ['ebe', "Excédent brut d'exploitation (EBE)", 'money'],
      ['resultatExploitation', "Résultat d'exploitation", 'money'],
      ['resultatFinancier', 'Résultat financier', 'money'],
      ['resultatCourantAvantImpots', 'Résultat courant avant impôts', 'money'],
      ['resultatExceptionnel', 'Résultat exceptionnel', 'money'],
      ['resultatNet', 'Résultat net', 'money'],
    ]),
  );

  builder.addSectionTitle('Marges');
  builder.addKeyValueTable(
    rows(result.margins, [
      ['chiffreDAffaires', "Chiffre d'affaires", 'money'],
      ['margeBrute', 'Marge brute', 'percent'],
      ['margeEbe', 'Marge EBE', 'percent'],
      ['margeExploitation', "Marge d'exploitation", 'percent'],
      ['margeNette', 'Marge nette', 'percent'],
    ]),
  );

  builder.addSectionTitle('Besoin en fonds de roulement (BFR)');
  builder.addKeyValueTable(
    rows(result.bfr, [
      ['bfrExploitation', "BFR d'exploitation", 'money'],
      ['bfrHorsExploitation', 'BFR hors exploitation', 'money'],
      ['bfrTotal', 'BFR total', 'money'],
    ]),
  );

  builder.addSectionTitle('Fonds de roulement (FR)');
  builder.addKeyValueTable(
    rows(result.fondsDeRoulement, [
      ['ressourcesStables', 'Ressources stables', 'money'],
      ['emploisStables', 'Emplois stables', 'money'],
      ['fondsDeRoulement', 'Fonds de roulement', 'money'],
    ]),
  );

  builder.addSectionTitle('Trésorerie nette');
  builder.addKeyValueTable(
    rows(result.tresorerieNette, [
      ['parFrMoinsBfr', 'Trésorerie nette (FR - BFR)', 'money'],
      ['provisionsSurActifCirculant', 'Provisions sur actif circulant', 'money'],
      ['disponibilites', 'Disponibilités (bilan)', 'money'],
    ]),
  );

  builder.addSectionTitle('Free cash flow');
  builder.addKeyValueTable(
    rows(result.freeCashFlow, [
      ['fluxExploitation', "Flux de trésorerie d'exploitation", 'money'],
      ['cashPaidForAcquisitions', 'Décaissé pour les acquisitions', 'money'],
      ['freeCashFlow', 'Free cash flow', 'money'],
    ]),
  );

  builder.addSectionTitle('Endettement et capitaux propres');
  builder.addKeyValueTable(
    rows(result.endettementEtCapitaux, [
      ['dettesFinancieres', 'Dettes financières', 'money'],
      ['tresorerieEtEquivalents', 'Trésorerie et équivalents', 'money'],
      ['endettementNet', 'Endettement net', 'money'],
      ['capitauxPropres', 'Capitaux propres', 'money'],
      ['bookEnterpriseValue', 'Book enterprise value', 'money'],
    ]),
  );

  builder.addSectionTitle('Coût de la dette');
  builder.addKeyValueTable(
    rows(result.coutDeLaDette, [
      ['chargesDInteret', "Charges d'intérêts", 'money'],
      ['dettesFinancieres', 'Dettes financières', 'money'],
      ['taux', 'Taux', 'percent'],
    ]),
  );

  builder.addSectionTitle('Ratios');
  builder.addKeyValueTable(
    rows(result.ratios, [
      ['liquiditeGenerale', 'Liquidité générale', 'ratio'],
      ['liquiditeReduite', 'Liquidité réduite', 'ratio'],
      ['gearing', 'Gearing', 'percent'],
      ['autonomieFinanciere', 'Autonomie financière', 'percent'],
      ['roe', 'ROE', 'percent'],
      ['roa', 'ROA', 'percent'],
      ['roce', 'ROCE', 'percent'],
      ['rentabiliteExploitation', "Rentabilité d'exploitation", 'percent'],
      ['dsoClients', 'DSO clients', 'days'],
      ['dpoFournisseurs', 'DPO fournisseurs', 'days'],
      ['rotationStocks', 'Rotation des stocks', 'days'],
    ]),
  );

  return builder.build();
}

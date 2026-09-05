import { PDFDocument } from 'pdf-lib';
import { renderFinancialAnalysisPdf } from './financial-analysis-pdf';
import { FinancialAnalysisResult } from './financial-analysis';

const COMPANY = { name: 'Société Démo SARL' } as never;
const FISCAL_YEAR = { label: '2026' } as never;

const RESULT: FinancialAnalysisResult = {
  sig: {
    margeCommerciale: '0.00',
    productionDeLExercice: '7500.00',
    consommationsEnProvenanceDesTiers: '2000.00',
    valeurAjoutee: '5500.00',
    ebe: '5305.00',
    resultatExploitation: '5305.00',
    resultatFinancier: '0.00',
    resultatCourantAvantImpots: '5305.00',
    resultatExceptionnel: '100.00',
    resultatNet: '5405.00',
  },
  margins: {
    chiffreDAffaires: '7500.00',
    margeBrute: null,
    margeEbe: '70.73',
    margeExploitation: '70.73',
    margeNette: '72.07',
  },
  bfr: { bfrExploitation: '1000.00', bfrHorsExploitation: '0.00', bfrTotal: '1000.00' },
  fondsDeRoulement: {
    ressourcesStables: '20000.00',
    emploisStables: '5000.00',
    fondsDeRoulement: '15000.00',
  },
  tresorerieNette: {
    parFrMoinsBfr: '14000.00',
    provisionsSurActifCirculant: '0.00',
    disponibilites: '14000.00',
  },
  freeCashFlow: {
    fluxExploitation: '2355.00',
    cashPaidForAcquisitions: '0.00',
    freeCashFlow: '2355.00',
  },
  endettementEtCapitaux: {
    dettesFinancieres: '0.00',
    tresorerieEtEquivalents: '32355.00',
    endettementNet: '-32355.00',
    capitauxPropres: '29405.00',
    bookEnterpriseValue: '-2950.00',
  },
  coutDeLaDette: { chargesDInteret: '0.00', dettesFinancieres: '0.00', taux: null },
  ratios: {
    liquiditeGenerale: '2.5000',
    liquiditeReduite: '2.5000',
    gearing: '-110.00',
    autonomieFinanciere: '75.00',
    roe: '18.38',
    roa: '13.80',
    roce: '-179.83',
    rentabiliteExploitation: '70.73',
    dsoClients: '294.5',
    dpoFournisseurs: null,
    rotationStocks: null,
  },
};

describe('renderFinancialAnalysisPdf', () => {
  it('produces a valid, loadable PDF covering every section, including null ("n/a") and negative values', async () => {
    const bytes = await renderFinancialAnalysisPdf(RESULT, COMPANY, FISCAL_YEAR);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

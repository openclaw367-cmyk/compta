import { PDFDocument } from 'pdf-lib';
import { renderCashFlowPdf } from './cash-flow-pdf';
import { CashFlowStatement } from './cash-flow-statement';

const COMPANY = { name: 'Société Démo SARL' } as never;
const FISCAL_YEAR = { label: '2026' } as never;

const STATEMENT: CashFlowStatement = {
  fluxExploitation: {
    resultatNet: '5405.00',
    dotationsAmortissementsProvisions: '0.00',
    reprisesAmortissementsProvisions: '0.00',
    valeurComptableElementsCedes: '0.00',
    produitsDesCessions: '0.00',
    capaciteAutofinancement: '5405.00',
    variationCreancesClients: '-1000.00',
    variationStocks: '0.00',
    variationTvaDeductibleAutres: '0.00',
    variationDettesExploitation: '-2050.00',
    total: '2355.00',
  },
  fluxInvestissement: {
    acquisitionsImmobilisations: '0.00',
    variationTvaDeductibleImmobilisations: '0.00',
    variationDettesSurImmobilisations: '0.00',
    cessionsImmobilisations: '6000.00',
    variationCreancesSurCessions: '0.00',
    total: '6000.00',
  },
  fluxFinancement: {
    variationEmprunts: '9000.00',
    variationCapital: '0.00',
    variationComptesCourantsAssocies: '0.00',
    distributions: '0.00',
    total: '9000.00',
  },
  variationTresorerie: '17355.00',
  tresorerieOuverture: '15000.00',
  tresorerieCloture: '32355.00',
};

describe('renderCashFlowPdf', () => {
  it('produces a valid, loadable PDF, including a negative amount', async () => {
    const bytes = await renderCashFlowPdf(STATEMENT, COMPANY, FISCAL_YEAR);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

import { PDFDocument } from 'pdf-lib';
import { renderResultatFiscalPdf } from './resultat-fiscal-pdf';
import { ResultatFiscalResult } from './resultat-fiscal';

const COMPANY = { name: 'Société Démo SARL' } as never;
const FISCAL_YEAR = { label: '2026' } as never;

const RESULT: ResultatFiscalResult = {
  resultatComptable: '5405.00',
  impotSurLesSocietes: { code: 'I7', label: 'Impôt sur les sociétés', montant: '0.00' },
  reintegrationsConfirmables: [
    { code: 'WJ', label: 'Amendes et pénalités', suggested: '0.00', confirmed: '150.00' },
    {
      code: 'WG',
      label: 'Taxe sur les véhicules des sociétés',
      suggested: '0.00',
      confirmed: '0.00',
    },
  ],
  reintegrationsDeclarees: [{ code: 'WD', label: 'Avantages personnels', montant: '200.00' }],
  totalReintegrations: '350.00',
  deductionsDeclarees: [{ code: 'XA', label: 'Déduction diverse', montant: '75.00' }],
  totalDeductions: '75.00',
  resultatFiscal: '5680.00',
};

describe('renderResultatFiscalPdf', () => {
  it('produces a valid, loadable PDF', async () => {
    const bytes = await renderResultatFiscalPdf(RESULT, COMPANY, FISCAL_YEAR);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

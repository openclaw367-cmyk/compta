import { PDFDocument } from 'pdf-lib';
import { renderVatDeclarationPdf } from './vat-declaration-pdf';
import { Ca3Declaration } from './ca3-declaration';
import { MonacoDeclaration } from './monaco-declaration';

const COMPANY_FR = { name: 'Société Démo SARL', jurisdiction: 'FR' } as never;
const COMPANY_MC = { name: 'Société Démo Monaco SARL', jurisdiction: 'MC' } as never;

const CA3: Ca3Declaration = {
  periodStart: '2026-04-01',
  periodEnd: '2026-04-30',
  collecteeByRate: [
    {
      ligne: '08',
      label: 'Taux normal 20 %',
      ratePercent: '20.00',
      baseHT: '1000.00',
      taxe: '200.00',
    },
    {
      ligne: '9B',
      label: 'Taux réduit 10 %',
      ratePercent: '10.00',
      baseHT: '500.00',
      taxe: '50.00',
    },
  ],
  ligne16: '250.00',
  ligne19: '90.00',
  ligne20: '60.00',
  ligne23: '150.00',
  ligne25: null,
  ligneTD: '100.00',
  ligne28: '100.00',
  ligne32: '100.00',
};

const MONACO: MonacoDeclaration = {
  periodStart: '2026-04-01',
  periodEnd: '2026-04-30',
  collecteeByRate: [
    {
      ligne: '32',
      label: 'Taux normal 20 %',
      ratePercent: '20.00',
      baseHT: '1000.00',
      taxe: '200.00',
    },
  ],
  ligneB1: '200.00',
  ligne44: '0.00',
  ligne45: '50.00',
  ligneB2: '50.00',
  ligneB3: null,
  ligne48: '150.00',
  ligne60: '150.00',
};

describe('renderVatDeclarationPdf', () => {
  it('renders a CA3 (FR) declaration', async () => {
    const bytes = await renderVatDeclarationPdf(CA3, COMPANY_FR, CA3.periodStart, CA3.periodEnd);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('renders a DSF (Monaco) declaration', async () => {
    const bytes = await renderVatDeclarationPdf(
      MONACO,
      COMPANY_MC,
      MONACO.periodStart,
      MONACO.periodEnd,
    );
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

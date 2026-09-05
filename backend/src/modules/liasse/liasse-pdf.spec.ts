import { PDFDocument } from 'pdf-lib';
import { renderLiassePdf } from './liasse-pdf';
import { LiasseResult, LiasseSimplifieResult } from './liasse.service';

const COMPANY = { name: 'Société Démo SARL' } as never;
const FISCAL_YEAR = { label: '2026' } as never;

const REEL_NORMAL: LiasseResult = {
  regime: 'REEL_NORMAL',
  bilan: {
    actif: [
      {
        code: 'AB',
        label: "Frais d'établissement",
        brut: '1000.00',
        amortissements: '200.00',
        net: '800.00',
      },
    ],
    totalActifBrut: '1000.00',
    totalActifAmortissements: '200.00',
    totalActifNet: '800.00',
    passif: [{ code: 'DA', label: 'Capital social', montant: '5000.00' }],
    resultatDeLExercice: '300.00',
    totalPassif: '5300.00',
  },
  compteResultat: {
    lignes: [{ code: 'FC', label: 'Ventes de marchandises', montant: '2000.00' }],
    beneficeOuPerte: '300.00',
  } as never,
  tableau2054: {
    lignes: [
      {
        code: 'AA',
        label: 'Terrains',
        valeurBruteDebut: '0.00',
        acquisitions: '1000.00',
        cessions: '0.00',
        valeurBruteFin: '1000.00',
      },
    ],
    totalGeneral: '1000.00',
  } as never,
  tableau2055: {
    lignes: [
      {
        code: 'AA',
        label: 'Terrains',
        montantDebut: '0.00',
        dotations: '200.00',
        diminutions: '0.00',
        montantFin: '200.00',
      },
    ],
    totalGeneral: '200.00',
  } as never,
  tableau2056: {
    lignes: [
      {
        code: 'AA',
        label: 'Provisions réglementées',
        montantDebut: '0.00',
        dotations: '100.00',
        reprises: '0.00',
        montantFin: '100.00',
      },
    ],
    totalGeneral: '100.00',
  } as never,
  tableau2057: {
    cadreA: [
      {
        code: 'BX',
        label: 'Créances clients',
        montantBrut: '500.00',
        aUnAnAuPlus: '500.00',
        aPlusDUnAn: '0.00',
      },
    ],
    totalCreances: '500.00',
    cadreB: [
      {
        code: 'DX',
        label: 'Dettes fournisseurs',
        montantBrut: '300.00',
        aUnAnAuPlus: '300.00',
        aPlusDUnAnEt5AnsAuPlus: '0.00',
        aPlusDe5Ans: '0.00',
      },
    ],
    totalDettes: '300.00',
    note: 'Note 2057.',
    maturityNote: 'Note échéances.',
  },
  tableau2059: {
    cadreA: [
      {
        assetId: 'asset-1',
        accountNumber: '214000',
        valeurOrigine: '80000.00',
        amortissements: '1677.78',
        valeurResiduelle: '78322.22',
      },
    ],
    cadreB: [
      {
        assetId: 'asset-1',
        accountNumber: '775200',
        prixDeVente: '90000.00',
        plusOuMoinsValue: '11677.78',
        qualification: null,
      },
    ],
    totalCourtTerme: '0.00',
    totalLongTerme: '0.00',
    totalNonQualifie: '11677.78',
    note: 'Note 2059.',
  },
};

const REEL_SIMPLIFIE: LiasseSimplifieResult = {
  regime: 'REEL_SIMPLIFIE',
  bilan: {
    actif: [
      {
        code: '028',
        label: 'Immobilisations corporelles',
        brut: '1000.00',
        amortissements: '200.00',
        net: '800.00',
      },
    ],
    totalActifBrut: '1000.00',
    totalActifAmortissements: '200.00',
    totalActifNet: '800.00',
    passif: [{ code: '120', label: 'Capital social', montant: '5000.00' }],
    resultatDeLExercice: '300.00',
    totalPassif: '5300.00',
  } as never,
  compteResultat: {
    lignes: [{ code: '210', label: 'Ventes de marchandises', montant: '2000.00' }],
    beneficeOuPerte: '300.00',
  } as never,
};

describe('renderLiassePdf', () => {
  it('renders a RÉEL_NORMAL liasse across all 7 sections', async () => {
    const bytes = await renderLiassePdf(REEL_NORMAL, COMPANY, FISCAL_YEAR);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('renders a RÉEL_SIMPLIFIE liasse with only bilan + compte de résultat', async () => {
    const bytes = await renderLiassePdf(REEL_SIMPLIFIE, COMPANY, FISCAL_YEAR);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('handles a RÉEL_NORMAL liasse with no disposals this year (empty 2059-A)', async () => {
    const noDisposals: LiasseResult = {
      ...REEL_NORMAL,
      tableau2059: {
        cadreA: [],
        cadreB: [],
        totalCourtTerme: '0.00',
        totalLongTerme: '0.00',
        totalNonQualifie: '0.00',
        note: 'Aucune cession.',
      },
    };
    const bytes = await renderLiassePdf(noDisposals, COMPANY, FISCAL_YEAR);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

import { ConflictException } from '@nestjs/common';
import { Regime } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { CompaniesService } from '../companies/companies.service';
import { FiscalYearsService } from '../fiscal-years/fiscal-years.service';
import { LiasseService } from '../liasse/liasse.service';
import { FinancialAnalysisService } from '../financial-analysis/financial-analysis.service';
import { LedgerService } from '../ledger/ledger.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };

function fiscalYear(id: string, label: string, startDate: string, closedAt: string | null = null) {
  return {
    id,
    label,
    startDate: new Date(startDate),
    endDate: new Date(`${startDate.slice(0, 4)}-12-31`),
    closedAt: closedAt ? new Date(closedAt) : null,
    companyId: 'company-1',
  };
}

function liasseResult(overrides: { ca?: never } = {}) {
  void overrides;
  return {
    regime: 'REEL_NORMAL' as const,
    bilan: {
      actif: [
        {
          code: 'CF',
          label: 'Disponibilités',
          brut: '5000.00',
          amortissements: '0.00',
          net: '5000.00',
        },
      ],
      passif: [{ code: 'DX', label: 'Dettes fournisseurs', montant: '1200.00' }],
      totalActifBrut: '0.00',
      totalActifAmortissements: '0.00',
      totalActifNet: '0.00',
      resultatDeLExercice: '0.00',
      totalPassif: '0.00',
    },
    compteResultat: {
      lignes: [],
      totalProduitsExploitation: '0.00',
      totalChargesExploitation: '0.00',
      resultatExploitation: '0.00',
      beneficeAttribueOuPerteTransferee: null,
      perteSupporteeOuBeneficeTransfere: null,
      totalProduitsFinanciers: '0.00',
      totalChargesFinancieres: '0.00',
      resultatFinancier: '0.00',
      resultatCourantAvantImpots: '0.00',
      resultatExceptionnel: '0.00',
      totalProduits: '25000.00',
      totalCharges: '18000.00',
      beneficeOuPerte: '7000.00',
    },
    tableau2054: {} as never,
    tableau2055: {} as never,
    tableau2056: {} as never,
    tableau2057: {
      cadreA: [
        {
          code: 'BX',
          label: 'Clients',
          montantBrut: '3400.00',
          aUnAnAuPlus: '3400.00',
          aPlusDUnAn: '0.00',
        },
      ],
      totalCreances: '3400.00',
      cadreB: [],
      totalDettes: '0.00',
      note: '',
      maturityNote: '',
    },
    tableau2059: {} as never,
  };
}

function financialAnalysisResult(chiffreDAffaires: string, ebe = '3000.00') {
  return {
    sig: {
      margeCommerciale: '0.00',
      productionDeLExercice: '0.00',
      consommationsEnProvenanceDesTiers: '0.00',
      valeurAjoutee: '0.00',
      ebe,
      resultatExploitation: '0.00',
      resultatFinancier: '0.00',
      resultatCourantAvantImpots: '0.00',
      resultatExceptionnel: '0.00',
      resultatNet: '7000.00',
    },
    margins: {
      chiffreDAffaires,
      margeBrute: null,
      margeEbe: '12.00',
      margeExploitation: null,
      margeNette: null,
    },
    bfr: { bfrExploitation: '0.00', bfrHorsExploitation: '0.00', bfrTotal: '0.00' },
    fondsDeRoulement: { fondsDeRoulement: '0.00' } as never,
    tresorerieNette: { tresorerieNette: '0.00' } as never,
    freeCashFlow: { freeCashFlow: '0.00' } as never,
    endettementEtCapitaux: {} as never,
    coutDeLaDette: { coutDeLaDette: null },
    ratios: {} as never,
  };
}

function buildService() {
  const findCurrent = jest.fn();
  const companies = { findCurrent } as unknown as CompaniesService;

  const findAll = jest.fn();
  const fiscalYears = { findAll } as unknown as FiscalYearsService;

  const liasseGenerate = jest.fn();
  const liasse = { generate: liasseGenerate } as unknown as LiasseService;

  const financialAnalysisGenerate = jest.fn();
  const financialAnalysis = {
    generate: financialAnalysisGenerate,
  } as unknown as FinancialAnalysisService;

  const trialBalance = jest.fn();
  const recentEntriesForClass = jest.fn();
  const ledger = { trialBalance, recentEntriesForClass } as unknown as LedgerService;

  const service = new DashboardService(companies, fiscalYears, liasse, financialAnalysis, ledger);
  return {
    service,
    findCurrent,
    findAll,
    liasseGenerate,
    financialAnalysisGenerate,
    trialBalance,
    recentEntriesForClass,
  };
}

describe('DashboardService', () => {
  it('returns available:false for a régime réel simplifié company, never a réel-normal figure', async () => {
    const { service, findCurrent } = buildService();
    findCurrent.mockResolvedValue({ regime: Regime.REEL_SIMPLIFIE });

    const result = await service.getSummary(company);

    expect(result.available).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/réel simplifié/);
  });

  it('returns available:false when the company has no fiscal years', async () => {
    const { service, findCurrent, findAll } = buildService();
    findCurrent.mockResolvedValue({ regime: Regime.REEL_NORMAL });
    findAll.mockResolvedValue([]);

    const result = await service.getSummary(company);

    expect(result.available).toBe(false);
  });

  it('picks the OPEN fiscal year, not just the most recent one, when a closed year is more recent in the list', async () => {
    const {
      service,
      findCurrent,
      findAll,
      liasseGenerate,
      financialAnalysisGenerate,
      trialBalance,
      recentEntriesForClass,
    } = buildService();
    findCurrent.mockResolvedValue({ regime: Regime.REEL_NORMAL });
    findAll.mockResolvedValue([
      fiscalYear('fy-2026', '2026', '2026-01-01'),
      fiscalYear('fy-2025', '2025', '2025-01-01', '2025-12-31'),
    ]);
    liasseGenerate.mockResolvedValue(liasseResult());
    financialAnalysisGenerate.mockResolvedValue(financialAnalysisResult('25000.00'));
    trialBalance.mockResolvedValue({ lines: [] });
    recentEntriesForClass.mockResolvedValue([]);

    const result = await service.getSummary(company);

    expect(result.available).toBe(true);
    expect((result as { fiscalYear: { id: string } }).fiscalYear.id).toBe('fy-2026');
    expect(liasseGenerate).toHaveBeenCalledWith(company, { fiscalYearId: 'fy-2026' });
  });

  it('honors an explicitly requested fiscal year (the app-wide selector) over the open/most-recent heuristic', async () => {
    const {
      service,
      findCurrent,
      findAll,
      liasseGenerate,
      financialAnalysisGenerate,
      trialBalance,
      recentEntriesForClass,
    } = buildService();
    findCurrent.mockResolvedValue({ regime: Regime.REEL_NORMAL });
    findAll.mockResolvedValue([
      fiscalYear('fy-2026', '2026', '2026-01-01'),
      fiscalYear('fy-2025', '2025', '2025-01-01', '2025-12-31'),
    ]);
    liasseGenerate.mockResolvedValue(liasseResult());
    financialAnalysisGenerate.mockResolvedValue(financialAnalysisResult('25000.00'));
    trialBalance.mockResolvedValue({ lines: [] });
    recentEntriesForClass.mockResolvedValue([]);

    const result = await service.getSummary(company, 'fy-2025');

    expect(result.available).toBe(true);
    expect((result as { fiscalYear: { id: string } }).fiscalYear.id).toBe('fy-2025');
    expect(liasseGenerate).toHaveBeenCalledWith(company, { fiscalYearId: 'fy-2025' });
  });

  it('falls back to the open/most-recent heuristic when the requested fiscal year id belongs to a different company', async () => {
    const {
      service,
      findCurrent,
      findAll,
      liasseGenerate,
      financialAnalysisGenerate,
      trialBalance,
      recentEntriesForClass,
    } = buildService();
    findCurrent.mockResolvedValue({ regime: Regime.REEL_NORMAL });
    findAll.mockResolvedValue([fiscalYear('fy-2026', '2026', '2026-01-01')]);
    liasseGenerate.mockResolvedValue(liasseResult());
    financialAnalysisGenerate.mockResolvedValue(financialAnalysisResult('25000.00'));
    trialBalance.mockResolvedValue({ lines: [] });
    recentEntriesForClass.mockResolvedValue([]);

    const result = await service.getSummary(company, 'fy-from-another-company');

    expect(result.available).toBe(true);
    expect((result as { fiscalYear: { id: string } }).fiscalYear.id).toBe('fy-2026');
  });

  it('degrades to available:false with the real guard message when the current fiscal year has draft écritures', async () => {
    const { service, findCurrent, findAll, liasseGenerate } = buildService();
    findCurrent.mockResolvedValue({ regime: Regime.REEL_NORMAL });
    findAll.mockResolvedValue([fiscalYear('fy-2026', '2026', '2026-01-01')]);
    liasseGenerate.mockRejectedValue(
      new ConflictException('3 écriture(s) non validée(s) empêchent la génération.'),
    );

    const result = await service.getSummary(company);

    expect(result.available).toBe(false);
    expect((result as { reason: string }).reason).toContain('non validée');
  });

  it('maps CF/DX/BX/produits/charges/EBE from the underlying, already-verified results — no re-derivation', async () => {
    const {
      service,
      findCurrent,
      findAll,
      liasseGenerate,
      financialAnalysisGenerate,
      trialBalance,
      recentEntriesForClass,
    } = buildService();
    findCurrent.mockResolvedValue({ regime: Regime.REEL_NORMAL });
    findAll.mockResolvedValue([fiscalYear('fy-2026', '2026', '2026-01-01')]);
    liasseGenerate.mockResolvedValue(liasseResult());
    financialAnalysisGenerate.mockResolvedValue(financialAnalysisResult('25000.00'));
    trialBalance.mockResolvedValue({ lines: [] });
    recentEntriesForClass.mockResolvedValue([]);

    const result = await service.getSummary(company);

    expect(result).toMatchObject({
      available: true,
      tresorerie: '5000.00',
      dettesFournisseurs: '1200.00',
      encoursClient: '3400.00',
      revenus: '25000.00',
      depenses: '18000.00',
      ebe: '3000.00',
      resultatNet: '7000.00',
      chiffreAffaires: '25000.00',
    });
  });

  it('builds CA history oldest-to-newest, honestly omitting a year that fails to compute rather than faking zero', async () => {
    const {
      service,
      findCurrent,
      findAll,
      liasseGenerate,
      financialAnalysisGenerate,
      trialBalance,
      recentEntriesForClass,
    } = buildService();
    findCurrent.mockResolvedValue({ regime: Regime.REEL_NORMAL });
    findAll.mockResolvedValue([
      fiscalYear('fy-2026', '2026', '2026-01-01'),
      fiscalYear('fy-2025', '2025', '2025-01-01', '2025-12-31'),
      fiscalYear('fy-2024', '2024', '2024-01-01', '2024-12-31'),
    ]);
    liasseGenerate.mockResolvedValue(liasseResult());
    financialAnalysisGenerate.mockImplementation((_c: unknown, dto: { fiscalYearId: string }) => {
      if (dto.fiscalYearId === 'fy-2026')
        return Promise.resolve(financialAnalysisResult('25000.00'));
      if (dto.fiscalYearId === 'fy-2025')
        return Promise.resolve(financialAnalysisResult('20000.00'));
      // fy-2024: the company's first ever fiscal year, no opening bilan — fails.
      return Promise.reject(new Error('no opening bilan'));
    });
    trialBalance.mockResolvedValue({ lines: [] });
    recentEntriesForClass.mockResolvedValue([]);

    const result = await service.getSummary(company);

    expect(result.available).toBe(true);
    const history = (result as { caHistory: { fiscalYearId: string; chiffreDAffaires: string }[] })
      .caHistory;
    expect(history.map((h) => h.fiscalYearId)).toEqual(['fy-2025', 'fy-2026']);
    expect(history[0].chiffreDAffaires).toBe('20000.00');
    expect(history[1].chiffreDAffaires).toBe('25000.00');
  });

  it('reuses the already-computed current-year analysis for the CA history point instead of calling generate() twice for the same year', async () => {
    const {
      service,
      findCurrent,
      findAll,
      liasseGenerate,
      financialAnalysisGenerate,
      trialBalance,
      recentEntriesForClass,
    } = buildService();
    findCurrent.mockResolvedValue({ regime: Regime.REEL_NORMAL });
    findAll.mockResolvedValue([fiscalYear('fy-2026', '2026', '2026-01-01')]);
    liasseGenerate.mockResolvedValue(liasseResult());
    financialAnalysisGenerate.mockResolvedValue(financialAnalysisResult('25000.00'));
    trialBalance.mockResolvedValue({ lines: [] });
    recentEntriesForClass.mockResolvedValue([]);

    await service.getSummary(company);

    expect(financialAnalysisGenerate).toHaveBeenCalledTimes(1);
  });

  it('splits comptes courants d\'associés into named sub-accounts and the flat 455000 "non ventilé" row', async () => {
    const {
      service,
      findCurrent,
      findAll,
      liasseGenerate,
      financialAnalysisGenerate,
      trialBalance,
      recentEntriesForClass,
    } = buildService();
    findCurrent.mockResolvedValue({ regime: Regime.REEL_NORMAL });
    findAll.mockResolvedValue([fiscalYear('fy-2026', '2026', '2026-01-01')]);
    liasseGenerate.mockResolvedValue(liasseResult());
    financialAnalysisGenerate.mockResolvedValue(financialAnalysisResult('25000.00'));
    trialBalance.mockResolvedValue({
      lines: [
        {
          accountId: 'a-1',
          accountNumber: '455000',
          accountLabel: 'Associés - Comptes courants',
          totalDebit: '0.00',
          totalCredit: '500.00',
          balance: '-500.00',
        },
        {
          accountId: 'a-2',
          accountNumber: '455001',
          accountLabel: 'Jean Dupont',
          totalDebit: '0.00',
          totalCredit: '2000.00',
          balance: '-2000.00',
        },
        {
          accountId: 'a-3',
          accountNumber: '607000',
          accountLabel: 'Achats',
          totalDebit: '100.00',
          totalCredit: '0.00',
          balance: '100.00',
        },
      ],
    });
    recentEntriesForClass.mockResolvedValue([]);

    const result = await service.getSummary(company);

    const lines = (
      result as {
        comptesCourantsAssocies: {
          accountNumber: string;
          isUnattributed: boolean;
          balance: string;
        }[];
      }
    ).comptesCourantsAssocies;
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.accountNumber === '455000')).toMatchObject({
      isUnattributed: true,
      balance: '-500.00',
    });
    expect(lines.find((l) => l.accountNumber === '455001')).toMatchObject({
      isUnattributed: false,
      balance: '-2000.00',
    });
  });

  it('fetches recent trésorerie (class-5) entries via LedgerService, not a hand-rolled query', async () => {
    const {
      service,
      findCurrent,
      findAll,
      liasseGenerate,
      financialAnalysisGenerate,
      trialBalance,
      recentEntriesForClass,
    } = buildService();
    findCurrent.mockResolvedValue({ regime: Regime.REEL_NORMAL });
    findAll.mockResolvedValue([fiscalYear('fy-2026', '2026', '2026-01-01')]);
    liasseGenerate.mockResolvedValue(liasseResult());
    financialAnalysisGenerate.mockResolvedValue(financialAnalysisResult('25000.00'));
    trialBalance.mockResolvedValue({ lines: [] });
    recentEntriesForClass.mockResolvedValue([
      {
        ecritureId: 'e-1',
        journalId: 'journal-bq',
        ecritureDate: '2026-03-01',
        libelle: 'Virement client',
        accountNumber: '512000',
        accountLabel: 'Banque',
        debit: '1000.00',
        credit: '0.00',
        isValidated: true,
      },
    ]);

    const result = await service.getSummary(company);

    expect(recentEntriesForClass).toHaveBeenCalledWith(company, 'fy-2026', 5, 8);
    expect((result as { recentBankEntries: unknown[] }).recentBankEntries).toHaveLength(1);
  });
});

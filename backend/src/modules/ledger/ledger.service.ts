import { Injectable, NotFoundException } from '@nestjs/common';
import { Account, FiscalYear } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import { TrialBalanceQueryDto } from './dto/trial-balance-query.dto';
import { TrialBalanceResponseDto } from './dto/trial-balance-response.dto';
import { AccountLedgerResponseDto } from './dto/account-ledger-response.dto';

/**
 * One écriture line on a single account, for `recentEntriesForClass()` —
 * a plain interface (no `@ApiProperty` DTO class) since, unlike
 * `trialBalance()`/`accountLedger()`, this method has no controller
 * endpoint of its own: it exists to be called in-process by
 * `DashboardService`, the same way `CashFlowService.buildContext()` is
 * called directly by `FinancialAnalysisService` rather than over HTTP.
 */
export interface RecentEntryLine {
  ecritureId: string;
  /** The écriture's own journal — lets a caller deep-link straight to this
   * line's écriture in the journal grid (which selects by journal), not
   * just its account. Additive: carries an identifier, computes nothing. */
  journalId: string;
  ecritureDate: string;
  libelle: string;
  accountNumber: string;
  accountLabel: string;
  debit: string;
  credit: string;
  isValidated: boolean;
}

/**
 * Trial balance (balance générale) and per-account grand livre. Reporting
 * only — reads écriture lines already persisted by EntriesService /
 * ImportExcelService, never writes. Includes draft (unvalidated) écritures
 * as well as validated ones: this is a working balance for day-to-day use,
 * not a compliance artifact (that's FEC export's job — see fec module).
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async trialBalance(
    company: CompanyContext,
    query: TrialBalanceQueryDto,
  ): Promise<TrialBalanceResponseDto> {
    const fiscalYear = await this.requireFiscalYear(company, query.fiscalYearId);
    const dateFilter = this.buildDateFilter(query.periodStart, query.periodEnd);

    const lignes = await this.prisma.ecritureLigne.findMany({
      where: {
        companyId: company.companyId,
        ecriture: { fiscalYearId: fiscalYear.id, ecritureDate: dateFilter },
      },
      include: { compte: true },
    });

    const totalsByAccount = new Map<string, { account: Account; debit: Money; credit: Money }>();
    for (const ligne of lignes) {
      const entry = totalsByAccount.get(ligne.compteId) ?? {
        account: ligne.compte,
        debit: Money.zero(),
        credit: Money.zero(),
      };
      entry.debit = entry.debit.plus(Money.fromDecimal(ligne.debit));
      entry.credit = entry.credit.plus(Money.fromDecimal(ligne.credit));
      totalsByAccount.set(ligne.compteId, entry);
    }

    let totalDebit = Money.zero();
    let totalCredit = Money.zero();
    const lines = Array.from(totalsByAccount.values())
      .sort((a, b) => a.account.number.localeCompare(b.account.number))
      .map(({ account, debit, credit }) => {
        totalDebit = totalDebit.plus(debit);
        totalCredit = totalCredit.plus(credit);
        return {
          accountId: account.id,
          accountNumber: account.number,
          accountLabel: account.label,
          totalDebit: debit.toApiString(),
          totalCredit: credit.toApiString(),
          balance: debit.minus(credit).toApiString(),
        };
      });

    return {
      fiscalYearId: fiscalYear.id,
      periodStart: query.periodStart,
      periodEnd: query.periodEnd,
      lines,
      totals: {
        debit: totalDebit.toApiString(),
        credit: totalCredit.toApiString(),
        balance: totalDebit.minus(totalCredit).toApiString(),
      },
    };
  }

  async accountLedger(
    company: CompanyContext,
    accountId: string,
    query: TrialBalanceQueryDto,
  ): Promise<AccountLedgerResponseDto> {
    const fiscalYear = await this.requireFiscalYear(company, query.fiscalYearId);
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, companyId: company.companyId },
    });
    if (!account) {
      throw new NotFoundException(`Account ${accountId} not found`);
    }
    const dateFilter = this.buildDateFilter(query.periodStart, query.periodEnd);

    const lignes = await this.prisma.ecritureLigne.findMany({
      where: {
        companyId: company.companyId,
        compteId: accountId,
        ecriture: { fiscalYearId: fiscalYear.id, ecritureDate: dateFilter },
      },
      include: { ecriture: { include: { journal: true } } },
      orderBy: [{ ecriture: { ecritureDate: 'asc' } }, { ecriture: { createdAt: 'asc' } }],
    });

    let running = Money.zero();
    let totalDebit = Money.zero();
    let totalCredit = Money.zero();
    const lines = lignes.map((ligne) => {
      const debit = Money.fromDecimal(ligne.debit);
      const credit = Money.fromDecimal(ligne.credit);
      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);
      running = running.plus(debit).minus(credit);
      return {
        ecritureId: ligne.ecriture.id,
        ecritureNum: ligne.ecriture.ecritureNum,
        journalCode: ligne.ecriture.journal.code,
        ecritureDate: ligne.ecriture.ecritureDate.toISOString().slice(0, 10),
        pieceRef: ligne.ecriture.pieceRef,
        libelle: ligne.ecriture.libelle,
        debit: debit.toApiString(),
        credit: credit.toApiString(),
        lettrage: ligne.lettrage,
        runningBalance: running.toApiString(),
      };
    });

    return {
      accountId: account.id,
      accountNumber: account.number,
      accountLabel: account.label,
      fiscalYearId: fiscalYear.id,
      periodStart: query.periodStart,
      periodEnd: query.periodEnd,
      lines,
      totals: {
        debit: totalDebit.toApiString(),
        credit: totalCredit.toApiString(),
        balance: totalDebit.minus(totalCredit).toApiString(),
      },
    };
  }

  /**
   * The most recent N écriture lines posted to a given PCG class (e.g. 5
   * for trésorerie), across a fiscal year — the primitive the
   * dashboard's "recent bank transactions" section needs and no
   * existing method exposed cleanly (`trialBalance()` only returns
   * per-account TOTALS, `EntriesService.findAll()` returns every line on
   * every account with no class filter). Reporting only, same as every
   * other method here: draft and validated lines both included, exactly
   * like `trialBalance()` — the caller renders `isValidated` rather than
   * this method silently picking a side.
   */
  async recentEntriesForClass(
    company: CompanyContext,
    fiscalYearId: string,
    pcgClass: number,
    limit: number,
  ): Promise<RecentEntryLine[]> {
    const lignes = await this.prisma.ecritureLigne.findMany({
      where: {
        companyId: company.companyId,
        ecriture: { fiscalYearId },
        compte: { pcgClass },
      },
      include: { compte: true, ecriture: true },
      orderBy: [{ ecriture: { ecritureDate: 'desc' } }, { ecriture: { createdAt: 'desc' } }],
      take: limit,
    });

    return lignes.map((ligne) => ({
      ecritureId: ligne.ecriture.id,
      journalId: ligne.ecriture.journalId,
      ecritureDate: ligne.ecriture.ecritureDate.toISOString().slice(0, 10),
      libelle: ligne.ecriture.libelle,
      accountNumber: ligne.compte.number,
      accountLabel: ligne.compte.label,
      debit: Money.fromDecimal(ligne.debit).toApiString(),
      credit: Money.fromDecimal(ligne.credit).toApiString(),
      isValidated: ligne.ecriture.validatedAt !== null,
    }));
  }

  private async requireFiscalYear(
    company: CompanyContext,
    fiscalYearId: string,
  ): Promise<FiscalYear> {
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId: company.companyId },
    });
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal year ${fiscalYearId} not found`);
    }
    return fiscalYear;
  }

  private buildDateFilter(
    periodStart?: string,
    periodEnd?: string,
  ): { gte?: Date; lte?: Date } | undefined {
    if (!periodStart && !periodEnd) {
      return undefined;
    }
    return {
      gte: periodStart ? new Date(periodStart) : undefined,
      lte: periodEnd ? new Date(periodEnd) : undefined,
    };
  }
}

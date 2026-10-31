import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Budget, BudgetLine } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import { LedgerService } from '../ledger/ledger.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { BudgetLineDto } from './dto/budget-line.dto';
import {
  type BudgetVarianceReport,
  computeBudgetVariance,
  computeBudgetVarianceTotals,
} from './budgeting';

type BudgetWithLines = Budget & {
  lines: (BudgetLine & { account: { number: string; label: string } })[];
};

/**
 * Budgeting / forecasting vs. actuals — roadmap item 2c, see
 * CLAUDE.md "Budgeting / forecasting". Pure metadata CRUD
 * (Budget/BudgetLine never touch the ledger — no écriture, no
 * posting, so a Budget is always safe to hard-delete, same reasoning
 * CLAUDE.md "Recurring entries / templates" already gives for
 * RecurringEntryTemplate) plus `compareToActual()`, which feeds
 * `LedgerService.trialBalance()`'s already-tested per-account actuals
 * into the pure `computeBudgetVariance()` — see budgeting.ts's own
 * doc comment for why `trialBalance()` was chosen over
 * `trial-balance-engine.ts`'s `buildTrialBalance()`.
 */
@Injectable()
export class BudgetingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async create(company: CompanyContext, dto: CreateBudgetDto) {
    await this.assertFiscalYearBelongsToCompany(company, dto.fiscalYearId);
    await this.assertLinesValid(company, dto.lines);

    const budget = await this.prisma.budget.create({
      data: {
        companyId: company.companyId,
        fiscalYearId: dto.fiscalYearId,
        label: dto.label,
        lines: {
          create: dto.lines.map((l) => ({
            companyId: company.companyId,
            accountId: l.accountId,
            plannedAmount: Money.fromString(l.plannedAmount).toDecimal(),
          })),
        },
      },
      include: { lines: { include: { account: { select: { number: true, label: true } } } } },
    });
    return this.toApi(budget);
  }

  async findAll(company: CompanyContext) {
    const budgets = await this.prisma.budget.findMany({
      where: { companyId: company.companyId },
      include: { lines: { include: { account: { select: { number: true, label: true } } } } },
      orderBy: [{ fiscalYear: { startDate: 'desc' } }, { label: 'asc' }],
    });
    return budgets.map((b) => this.toApi(b));
  }

  async findOne(company: CompanyContext, id: string) {
    return this.toApi(await this.fetchBudget(company, id));
  }

  /** Full replace of label/fiscalYear/lines — same shape as RecurringEntriesService.update(). */
  async update(company: CompanyContext, id: string, dto: CreateBudgetDto) {
    await this.fetchBudget(company, id);
    await this.assertFiscalYearBelongsToCompany(company, dto.fiscalYearId);
    await this.assertLinesValid(company, dto.lines);

    return this.prisma.$transaction(async (tx) => {
      await tx.budgetLine.deleteMany({ where: { budgetId: id } });
      const updated = await tx.budget.update({
        where: { id },
        data: {
          fiscalYearId: dto.fiscalYearId,
          label: dto.label,
          lines: {
            create: dto.lines.map((l) => ({
              companyId: company.companyId,
              accountId: l.accountId,
              plannedAmount: Money.fromString(l.plannedAmount).toDecimal(),
            })),
          },
        },
        include: { lines: { include: { account: { select: { number: true, label: true } } } } },
      });
      return this.toApi(updated);
    });
  }

  async remove(company: CompanyContext, id: string): Promise<void> {
    await this.fetchBudget(company, id);
    // Pure metadata — a Budget never itself becomes part of the ledger,
    // so a real hard delete is correct here, same reasoning CLAUDE.md
    // gives for RecurringEntryTemplate. Lines cascade (onDelete: Cascade
    // on BudgetLine.budget).
    await this.prisma.budget.delete({ where: { id } });
  }

  /**
   * The variance report — see budgeting.ts's own doc comment for the
   * "actual" primitive reused (LedgerService.trialBalance(), not
   * trial-balance-engine.ts) and the sign convention (magnitudes, not
   * per-PCG-class signed values). Scoped to the Budget's own
   * fiscalYearId, the WHOLE year (no periodStart/periodEnd) —
   * consistent with "tie a Budget to one FiscalYear," not an arbitrary
   * date range.
   */
  async compareToActual(company: CompanyContext, id: string): Promise<BudgetVarianceReport> {
    const budget = await this.fetchBudget(company, id);

    const trialBalance = await this.ledger.trialBalance(company, {
      fiscalYearId: budget.fiscalYearId,
    });
    const actuals = trialBalance.lines.map((l) => ({ accountId: l.accountId, balance: l.balance }));

    const lineInputs = budget.lines.map((l) => ({
      accountId: l.accountId,
      accountNumber: l.account.number,
      accountLabel: l.account.label,
      plannedAmount: Money.fromDecimal(l.plannedAmount).toApiString(),
    }));

    const lines = computeBudgetVariance(lineInputs, actuals);
    const totals = computeBudgetVarianceTotals(lines);

    return {
      budgetId: budget.id,
      budgetLabel: budget.label,
      fiscalYearId: budget.fiscalYearId,
      lines,
      totals,
    };
  }

  private async fetchBudget(company: CompanyContext, id: string): Promise<BudgetWithLines> {
    const budget = await this.prisma.budget.findFirst({
      where: { id, companyId: company.companyId },
      include: { lines: { include: { account: { select: { number: true, label: true } } } } },
    });
    if (!budget) {
      throw new NotFoundException(`Budget ${id} not found`);
    }
    return budget;
  }

  private async assertFiscalYearBelongsToCompany(
    company: CompanyContext,
    fiscalYearId: string,
  ): Promise<void> {
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId: company.companyId },
    });
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal year ${fiscalYearId} not found`);
    }
  }

  private async assertLinesValid(company: CompanyContext, lines: BudgetLineDto[]): Promise<void> {
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    if (accountIds.length !== lines.length) {
      throw new BadRequestException('A budget cannot list the same account twice.');
    }

    const accounts = await this.prisma.account.findMany({
      where: { companyId: company.companyId, id: { in: accountIds } },
    });
    if (accounts.length !== accountIds.length) {
      const found = new Set(accounts.map((a) => a.id));
      const missing = accountIds.filter((id) => !found.has(id));
      throw new NotFoundException(`Account(s) not found: ${missing.join(', ')}`);
    }
  }

  private toApi(budget: BudgetWithLines) {
    return {
      id: budget.id,
      companyId: budget.companyId,
      fiscalYearId: budget.fiscalYearId,
      label: budget.label,
      createdAt: budget.createdAt,
      updatedAt: budget.updatedAt,
      lines: budget.lines.map((l) => ({
        id: l.id,
        budgetId: l.budgetId,
        accountId: l.accountId,
        accountNumber: l.account.number,
        accountLabel: l.account.label,
        plannedAmount: Money.fromDecimal(l.plannedAmount).toApiString(),
      })),
    };
  }
}

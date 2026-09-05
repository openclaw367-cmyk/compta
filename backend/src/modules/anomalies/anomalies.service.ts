import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import {
  AccountMonthlySeries,
  TRAILING_MONTHS,
  SpendingAnomaly,
  addMonths,
  computeSpendingAnomalies,
  monthKey,
  monthsBetween,
} from './spending-anomaly-engine';
import {
  OpenInvoiceInput,
  PaymentAnomaly,
  UnmatchedStatementLineInput,
  computePaymentAnomalies,
} from './invoice-anomaly-engine';

export interface AnomaliesSummary {
  spending: SpendingAnomaly[];
  payments: PaymentAnomaly[];
}

function firstDayOfMonth(monthKeyStr: string): Date {
  const [year, month] = monthKeyStr.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

/**
 * Gentle, non-blocking flags — computed fresh on every request, never
 * persisted, never gating anything (see CLAUDE.md "Anomaly surfacing").
 * The two `detect*` methods do the Prisma fetch and hand pre-shaped,
 * Prisma-independent inputs to the two pure engines
 * (spending-anomaly-engine.ts / invoice-anomaly-engine.ts) — same split
 * as bank-reconciliation's own service/matching-engine.ts pair.
 */
@Injectable()
export class AnomaliesService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(company: CompanyContext, fiscalYearId: string): Promise<AnomaliesSummary> {
    if (!fiscalYearId) {
      throw new BadRequestException('fiscalYearId is required.');
    }
    const [spending, payments] = await Promise.all([
      this.detectSpendingAnomalies(company, fiscalYearId),
      this.detectPaymentAnomalies(company),
    ]);
    return { spending, payments };
  }

  /**
   * Scans class-6 (charges) and class-7 (produits) accounts for a month
   * whose total is >= MULTIPLIER × its own trailing average — see
   * spending-anomaly-engine.ts. Includes DRAFT écritures, not just
   * validated ones: this feature never gates or exports anything, so a
   * draft's very real spend signal is worth flagging just as much as a
   * validated one — unlike FEC/CA3/liasse, which require validated-only
   * data for compliance reasons that don't apply here.
   */
  async detectSpendingAnomalies(
    company: CompanyContext,
    fiscalYearId: string,
  ): Promise<SpendingAnomaly[]> {
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId: company.companyId },
    });
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal year ${fiscalYearId} not found`);
    }

    const today = new Date();
    const windowEnd = fiscalYear.endDate < today ? fiscalYear.endDate : today;
    const startMonth = monthKey(fiscalYear.startDate);
    const endMonth = monthKey(windowEnd);
    if (startMonth > endMonth) {
      // The fiscal year hasn't started yet relative to today — nothing to evaluate.
      return [];
    }
    const evaluatedMonths = monthsBetween(startMonth, endMonth);
    const windowStart = firstDayOfMonth(addMonths(startMonth, -TRAILING_MONTHS));

    const lignes = await this.prisma.ecritureLigne.findMany({
      where: {
        companyId: company.companyId,
        compte: { pcgClass: { in: [6, 7] } },
        ecriture: { ecritureDate: { gte: windowStart, lte: windowEnd } },
      },
      include: { compte: true, ecriture: { select: { ecritureDate: true } } },
    });

    const seriesByAccount = new Map<string, AccountMonthlySeries>();
    for (const ligne of lignes) {
      const amount =
        ligne.compte.pcgClass === 6
          ? Money.fromDecimal(ligne.debit)
          : Money.fromDecimal(ligne.credit);
      if (amount.isZero()) continue;

      let series = seriesByAccount.get(ligne.compteId);
      if (!series) {
        series = {
          accountId: ligne.compteId,
          accountNumber: ligne.compte.number,
          accountLabel: ligne.compte.label,
          months: [],
        };
        seriesByAccount.set(ligne.compteId, series);
      }
      const month = monthKey(ligne.ecriture.ecritureDate);
      const existing = series.months.find((m) => m.month === month);
      if (existing) {
        existing.amount = existing.amount.plus(amount);
      } else {
        series.months.push({ month, amount });
      }
    }

    return computeSpendingAnomalies(Array.from(seriesByAccount.values()), evaluatedMonths);
  }

  /**
   * Scans FINALIZED SALE invoices whose own posted écriture's client
   * ligne is still unlettered ("open" — there is no paid/unpaid status
   * on Invoice itself) against this company's UNMATCHED
   * BankStatementLines — see invoice-anomaly-engine.ts. Works fully
   * without any bank data at all (every open invoice still surfaces as
   * a NONE-tier "overdue, no bank movement found" flag).
   *
   * A single invoice whose posted écriture or client ligne can't be
   * found is SKIPPED, not thrown — a deliberate exception to this app's
   * usual "fail loud" default: this is a best-effort scan across
   * potentially many invoices, and one inconsistent row must never take
   * down every other invoice's flag (unlike previewApplication() or
   * finalize(), which are single, user-triggered operations where
   * failing loud is correct).
   */
  async detectPaymentAnomalies(company: CompanyContext): Promise<PaymentAnomaly[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        companyId: company.companyId,
        status: 'FINALIZED',
        type: 'SALE',
        postedEcritureId: { not: null },
      },
    });
    if (invoices.length === 0) return [];

    const ecritures = await this.prisma.ecriture.findMany({
      where: {
        id: { in: invoices.map((i) => i.postedEcritureId!) },
        companyId: company.companyId,
      },
      include: { lignes: true },
    });
    const ecrituresById = new Map(ecritures.map((e) => [e.id, e]));

    const openInvoices: OpenInvoiceInput[] = [];
    for (const invoice of invoices) {
      const ecriture = ecrituresById.get(invoice.postedEcritureId!);
      if (!ecriture || !invoice.invoiceDate) continue;
      const clientLigne = ecriture.lignes.find((l) => l.compteId === invoice.clientAccountId);
      if (!clientLigne || clientLigne.lettrage !== null) continue;

      openInvoices.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber ?? invoice.id,
        clientName: invoice.clientNameSnapshot ?? '—',
        totalTTC: Money.fromDecimal(clientLigne.debit),
        invoiceDate: invoice.invoiceDate,
      });
    }
    if (openInvoices.length === 0) return [];

    const statementLines = await this.prisma.bankStatementLine.findMany({
      where: { companyId: company.companyId, status: 'UNMATCHED' },
      include: { bankAccount: true },
    });
    const unmatchedStatementLines: UnmatchedStatementLineInput[] = statementLines.map((line) => ({
      id: line.id,
      amount: Money.fromDecimal(line.amount),
      bookingDate: line.bookingDate,
      bankAccountLabel: line.bankAccount.label,
    }));

    return computePaymentAnomalies(openInvoices, unmatchedStatementLines, new Date());
  }
}

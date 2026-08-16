import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import { assertFiscalYearOpen } from '../../common/ledger/assert-fiscal-year-open';
import { CreateEcritureLigneDto } from './dto/create-ecriture-ligne.dto';
import { isImmobilisationAccount } from './orphaned-immobilisation';

/**
 * Extracted verbatim from EntriesService (2026-08-16) so the AI chatbot's
 * propose_ecriture tool (see src/modules/ai-chat/tools/propose-tools.service.ts)
 * can run the EXACT SAME balance/reference/VAT/orphaned-immob checks
 * WITHOUT persisting — never a parallel, potentially-drifting
 * reimplementation. EntriesService.create()/update() now delegate here
 * too; this refactor changed zero behavior, verified by
 * entries.service.spec.ts passing unmodified. See CLAUDE.md "AI chatbot
 * Phase 2" for why this split exists: the structural write-gate promise
 * ("a proposal is validated exactly like a manual entry") is only true
 * if both paths call the literal same code, not code that merely looks
 * the same today and drifts tomorrow.
 */
@Injectable()
export class EntryValidationService {
  constructor(private readonly prisma: PrismaService) {}

  buildBalancedLignes(company: CompanyContext, lignes: CreateEcritureLigneDto[]) {
    let totalDebit = Money.zero();
    let totalCredit = Money.zero();

    const data = lignes.map((ligne) => {
      const debit = Money.fromString(ligne.debit ?? '0.00');
      const credit = Money.fromString(ligne.credit ?? '0.00');

      if (!debit.isZero() && !credit.isZero()) {
        throw new BadRequestException('A line cannot have both a debit and a credit amount.');
      }
      if (debit.isZero() && credit.isZero()) {
        throw new BadRequestException('A line must have either a debit or a credit amount.');
      }

      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);

      return {
        companyId: company.companyId,
        compteId: ligne.compteId,
        compteAuxId: ligne.compteAuxId,
        debit: debit.toDecimal(),
        credit: credit.toDecimal(),
        lettrage: ligne.lettrage,
        montantDevise: ligne.montantDevise
          ? Money.fromString(ligne.montantDevise).toDecimal()
          : undefined,
        idDevise: ligne.idDevise,
        vatRateId: ligne.vatRateId,
        dateEcheance: ligne.dateEcheance ? new Date(ligne.dateEcheance) : undefined,
      };
    });

    if (!totalDebit.equals(totalCredit)) {
      throw new BadRequestException(
        `Écriture does not balance: debit ${totalDebit.toApiString()} != credit ${totalCredit.toApiString()}.`,
      );
    }

    return data;
  }

  async assertReferencesBelongToCompany(
    company: CompanyContext,
    journalId: string,
    fiscalYearId: string,
  ): Promise<void> {
    const [journal, fiscalYear] = await Promise.all([
      this.prisma.journal.findFirst({ where: { id: journalId, companyId: company.companyId } }),
      this.prisma.fiscalYear.findFirst({
        where: { id: fiscalYearId, companyId: company.companyId },
      }),
    ]);
    if (!journal) {
      throw new NotFoundException(`Journal ${journalId} not found`);
    }
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal year ${fiscalYearId} not found`);
    }
    assertFiscalYearOpen(fiscalYear);
  }

  /**
   * "Orphaned immobilisation" guard (see CLAUDE.md "Known scope
   * boundaries" / "Immobilisations / cession") — a debit to a class-2
   * immobilisation account with no FixedAsset behind it silently misses
   * the 2054/2055/2059-A liasse annexes and dépreciation posting.
   * Non-blocking by design: there are legitimate reasons an account might
   * not have a fiche yet, so this returns a warning for the caller to
   * surface, never throws. Scoped to DEBIT lines only.
   */
  async computeOrphanedImmobilisationWarnings(
    company: CompanyContext,
    lignes: CreateEcritureLigneDto[],
  ): Promise<string[]> {
    const debitCompteIds = [
      ...new Set(
        lignes.filter((l) => !Money.fromString(l.debit ?? '0.00').isZero()).map((l) => l.compteId),
      ),
    ];
    if (debitCompteIds.length === 0) {
      return [];
    }
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: debitCompteIds }, companyId: company.companyId },
    });
    const immobilisationAccounts = accounts.filter(isImmobilisationAccount);
    if (immobilisationAccounts.length === 0) {
      return [];
    }
    const linkedAssets = await this.prisma.fixedAsset.findMany({
      where: {
        companyId: company.companyId,
        accountId: { in: immobilisationAccounts.map((a) => a.id) },
      },
      select: { accountId: true },
    });
    const linkedAccountIds = new Set(linkedAssets.map((fa) => fa.accountId));
    return immobilisationAccounts
      .filter((a) => !linkedAccountIds.has(a.id))
      .map(
        (a) =>
          `Le compte ${a.number} (« ${a.label} ») est un compte d'immobilisation débité sans ` +
          "fiche immobilisation associée — elle n'apparaîtra pas dans les tableaux 2054/2055/" +
          "2059 de la liasse ni dans le plan d'amortissement. Créez la fiche depuis l'écran " +
          "Immobilisations si ce n'est pas volontaire.",
      );
  }

  /**
   * A tagged vatRateId must belong to this company — same multi-tenant
   * scoping rule as every other reference.
   */
  async assertVatRatesBelongToCompany(
    company: CompanyContext,
    lignes: CreateEcritureLigneDto[],
  ): Promise<void> {
    const vatRateIds = [
      ...new Set(lignes.map((l) => l.vatRateId).filter((id): id is string => Boolean(id))),
    ];
    if (vatRateIds.length === 0) {
      return;
    }
    const rates = await this.prisma.vatRate.findMany({
      where: { id: { in: vatRateIds }, companyId: company.companyId },
    });
    if (rates.length !== vatRateIds.length) {
      throw new BadRequestException(
        'One or more VAT rate references do not belong to this company.',
      );
    }
  }
}

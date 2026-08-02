import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Ecriture, FiscalYear, JournalType, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import { assertFiscalYearOpen } from '../../common/ledger/assert-fiscal-year-open';

/** Balance-sheet (bilan) classes: carried forward account-by-account. */
const BILAN_CLASSES = [1, 2, 3, 4, 5];
/** Income-statement classes: never carried — they reset to zero and fold into the result line instead. */
const RESULT_CLASSES = [6, 7];

/**
 * Where the prior year's net result lands, unaffected — see CLAUDE.md-style
 * reasoning: at à-nouveau time the AGM hasn't voted on affectation du
 * résultat yet (that can happen months into the new year), so the result
 * is carried whole into 120/129 rather than pre-split into réserves /
 * report à nouveau / dividendes. A later, separate "affectation" entry
 * (not built yet) reclassifies it once the AGM decides.
 */
const RESULTAT_BENEFICE_ACCOUNT = '120000';
const RESULTAT_PERTE_ACCOUNT = '129000';

interface AccountBalance {
  compteId: string;
  compteAuxId: string | null;
  /** debit - credit, prior-year closing balance for this (compte, compteAux) pair. */
  net: Money;
}

/**
 * À-nouveau (opening balance carry-forward) generation. Reads a closed
 * prior fiscal year's ledger and posts one validated écriture in the AN
 * journal, dated the new year's start, carrying forward classes 1-5
 * account-by-account (and tiers-by-tiers, since ledger lines for a
 * collectif like 411/401 key on compteId+compteAuxId — carrying only the
 * collectif total would lose which client/supplier owes what). Classes 6-7
 * reset to zero and fold into a single 120/129 result line instead (see
 * RESULTAT_*_ACCOUNT above). Class 8 (comptes spéciaux) is out of scope —
 * see the guard in buildLignes.
 */
@Injectable()
export class ANouveauService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(company: CompanyContext, targetFiscalYearId: string): Promise<Ecriture> {
    const target = await this.requireFiscalYear(company, targetFiscalYearId);
    assertFiscalYearOpen(target);

    const prior = await this.findPriorFiscalYear(company, target);
    if (!prior) {
      throw new BadRequestException(
        `No fiscal year precedes "${target.label}" — there is nothing to carry forward.`,
      );
    }
    if (!prior.closedAt) {
      throw new ConflictException(
        `Cannot generate à-nouveau: prior fiscal year "${prior.label}" is not closed yet.`,
      );
    }

    const anJournal = await this.prisma.journal.findFirst({
      where: { companyId: company.companyId, type: JournalType.A_NOUVEAU },
      orderBy: { code: 'asc' },
    });
    if (!anJournal) {
      throw new NotFoundException(
        'No à-nouveau journal (type A_NOUVEAU) exists for this company — create one first.',
      );
    }

    const existing = await this.prisma.ecriture.findFirst({
      where: { companyId: company.companyId, fiscalYearId: target.id, journalId: anJournal.id },
    });
    if (existing) {
      throw new ConflictException(
        `À-nouveau entries already exist for fiscal year "${target.label}" — no double carry-forward. ` +
          'Correct via a reversing entry (contre-passation) if needed.',
      );
    }

    const lignesData = await this.buildLignes(company, prior.id);

    return this.prisma.$transaction(async (tx) => {
      const companyRecord = await tx.company.update({
        where: { id: company.companyId },
        data: { nextEcritureNum: { increment: 1 } },
      });
      const ecritureNum = String(companyRecord.nextEcritureNum - 1);

      return tx.ecriture.create({
        data: {
          companyId: company.companyId,
          journalId: anJournal.id,
          fiscalYearId: target.id,
          ecritureDate: target.startDate,
          libelle: `À-nouveau ${target.label} (report de ${prior.label})`,
          ecritureNum,
          validatedAt: new Date(),
          lignes: { create: lignesData },
        },
        include: { lignes: true },
      });
    });
  }

  /**
   * Aggregates the prior year's ledger into one signed net balance per
   * (compte, compteAux) pair for classes 1-5, folds classes 6-7 into a
   * single result adjustment on 120/129, and returns the à-nouveau line
   * data. Asserts the block balances by construction — a mismatch means
   * the prior year's own bilan didn't balance, which must surface loudly
   * rather than silently produce an unbalanced écriture.
   */
  private async buildLignes(
    company: CompanyContext,
    priorFiscalYearId: string,
  ): Promise<Prisma.EcritureLigneCreateManyEcritureInput[]> {
    const ligneRows = await this.prisma.ecritureLigne.findMany({
      where: { companyId: company.companyId, ecriture: { fiscalYearId: priorFiscalYearId } },
      include: { compte: true },
    });

    const balances = new Map<string, AccountBalance>();
    let resultNet = Money.zero(); // credit - debit across classes 6+7; positive = bénéfice.
    let class8Net = Money.zero();

    for (const ligne of ligneRows) {
      const debit = Money.fromDecimal(ligne.debit);
      const credit = Money.fromDecimal(ligne.credit);
      const pcgClass = ligne.compte.pcgClass;

      if (RESULT_CLASSES.includes(pcgClass)) {
        resultNet = resultNet.plus(credit).minus(debit);
        continue;
      }
      if (pcgClass === 8) {
        class8Net = class8Net.plus(debit).minus(credit);
        continue;
      }
      if (!BILAN_CLASSES.includes(pcgClass)) {
        continue;
      }

      const key = `${ligne.compteId}::${ligne.compteAuxId ?? ''}`;
      const entry = balances.get(key) ?? {
        compteId: ligne.compteId,
        compteAuxId: ligne.compteAuxId,
        net: Money.zero(),
      };
      entry.net = entry.net.plus(debit).minus(credit);
      balances.set(key, entry);
    }

    if (!class8Net.isZero()) {
      throw new ConflictException(
        'Prior fiscal year has non-zero class 8 (comptes spéciaux) balances — à-nouveau carry-forward ' +
          "for class 8 isn't implemented (these are off-balance-sheet memo accounts, not bilan " +
          'balances). Clear or reverse the class 8 movements before generating.',
      );
    }

    if (!resultNet.isZero()) {
      const resultAccountNumber = resultNet.isPositive()
        ? RESULTAT_BENEFICE_ACCOUNT
        : RESULTAT_PERTE_ACCOUNT;
      const resultAccount = await this.prisma.account.findFirst({
        where: { companyId: company.companyId, number: resultAccountNumber },
      });
      if (!resultAccount) {
        throw new NotFoundException(
          `Account "${resultAccountNumber}" is required to carry the prior year's result but does ` +
            'not exist for this company — create it first.',
        );
      }
      const key = `${resultAccount.id}::`;
      const entry = balances.get(key) ?? {
        compteId: resultAccount.id,
        compteAuxId: null,
        net: Money.zero(),
      };
      // Bénéfice (resultNet > 0) is a credit to 120 -> net decreases by resultNet.
      // Perte (resultNet < 0) is a debit to 129 -> net increases by |resultNet|.
      // Both are exactly "subtract resultNet".
      entry.net = entry.net.minus(resultNet);
      balances.set(key, entry);
    }

    let totalDebit = Money.zero();
    let totalCredit = Money.zero();
    const lignesData: Prisma.EcritureLigneCreateManyEcritureInput[] = [];
    for (const { compteId, compteAuxId, net } of balances.values()) {
      if (net.isZero()) {
        continue;
      }
      if (net.isPositive()) {
        totalDebit = totalDebit.plus(net);
        lignesData.push({
          companyId: company.companyId,
          compteId,
          compteAuxId: compteAuxId ?? undefined,
          debit: net.toDecimal(),
          credit: Money.zero().toDecimal(),
        });
      } else {
        const amount = Money.zero().minus(net);
        totalCredit = totalCredit.plus(amount);
        lignesData.push({
          companyId: company.companyId,
          compteId,
          compteAuxId: compteAuxId ?? undefined,
          debit: Money.zero().toDecimal(),
          credit: amount.toDecimal(),
        });
      }
    }

    if (lignesData.length === 0) {
      throw new BadRequestException(
        'Prior fiscal year has no non-zero balance-sheet balances to carry forward.',
      );
    }
    if (!totalDebit.equals(totalCredit)) {
      throw new InternalServerErrorException(
        `À-nouveau block does not balance (debit ${totalDebit.toApiString()} != credit ` +
          `${totalCredit.toApiString()}) — the prior fiscal year's bilan itself is unbalanced.`,
      );
    }

    return lignesData;
  }

  private async requireFiscalYear(company: CompanyContext, id: string): Promise<FiscalYear> {
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id, companyId: company.companyId },
    });
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal year ${id} not found`);
    }
    return fiscalYear;
  }

  private findPriorFiscalYear(
    company: CompanyContext,
    target: { id: string; startDate: Date },
  ): Promise<FiscalYear | null> {
    return this.prisma.fiscalYear.findFirst({
      where: {
        companyId: company.companyId,
        id: { not: target.id },
        endDate: { lt: target.startDate },
      },
      orderBy: { endDate: 'desc' },
    });
  }
}

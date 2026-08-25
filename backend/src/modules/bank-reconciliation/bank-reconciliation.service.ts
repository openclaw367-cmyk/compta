import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BankStatementLine, BankStatementLineStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { EntriesService, EcritureWriteResult } from '../entries/entries.service';
import { CreateEcritureDto } from '../entries/dto/create-ecriture.dto';
import {
  CandidateLigne,
  DATE_WINDOW_DAYS,
  MatchableStatementLine,
  StatementLineMatchProposal,
  matchStatementLines,
} from './matching-engine';

const LETTRAGE_PREFIX = 'R'; // "Rapprochement" — a distinct namespace from any manual lettrage code, so the two never collide.

/**
 * Orchestrates the review step: fetches unmatched statement lines +
 * candidate unlettered lignes, runs the (pure, stateless) matching
 * engine fresh every call — nothing about a PROPOSAL is ever persisted,
 * only a CONFIRMED result is (see matching-engine.ts's own doc
 * comment). Every mutating method here reuses EntriesService's own
 * write paths (setLettrage, create) rather than touching Prisma's
 * ledger tables directly — no privileged write path exists in this
 * module. See CLAUDE.md "Bank reconciliation".
 */
@Injectable()
export class BankReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entries: EntriesService,
  ) {}

  /**
   * All of a bank account's statement lines — the review UI's own list
   * of "what's on the statement," shown alongside whatever
   * getProposals() currently proposes for the still-UNMATCHED ones.
   */
  async listStatementLines(
    company: CompanyContext,
    bankAccountId: string,
  ): Promise<BankStatementLine[]> {
    await this.requireBankAccount(company, bankAccountId);
    await this.healOrphanedMatches(company, bankAccountId);
    return this.prisma.bankStatementLine.findMany({
      where: { companyId: company.companyId, bankAccountId },
      orderBy: { bookingDate: 'asc' },
    });
  }

  /**
   * `BankStatementLine.matchedLigneId` intentionally has NO cascade-
   * blocking relation to EcritureLigne (`ON DELETE SET NULL`, Prisma's
   * own default for an optional relation — deliberately NOT the
   * `onDelete: Cascade` fix EcritureDocument needed, since that field is
   * required and this one isn't) — deleting a draft écriture whose line
   * was bank-matched is a legitimate, ordinary action from the Écritures
   * screen, and EntriesModule must never need to know this module
   * exists (the same module-boundary reasoning as the rest of this
   * file). Found live, not by inspection: deleting a matched draft's
   * line correctly nulls `matchedLigneId` at the DB level, but silently
   * leaves `status: CONFIRMED` behind — a real orphaned-match state a
   * user would otherwise never be able to see or fix (the line looks
   * "already reconciled" in the review UI forever). Self-heals on every
   * read here rather than needing EntriesModule to know about this
   * module at all.
   */
  private async healOrphanedMatches(company: CompanyContext, bankAccountId: string): Promise<void> {
    await this.prisma.bankStatementLine.updateMany({
      where: {
        companyId: company.companyId,
        bankAccountId,
        status: BankStatementLineStatus.CONFIRMED,
        matchedLigneId: null,
      },
      data: { status: BankStatementLineStatus.UNMATCHED },
    });
  }

  async getProposals(
    company: CompanyContext,
    bankAccountId: string,
  ): Promise<StatementLineMatchProposal[]> {
    const bankAccount = await this.requireBankAccount(company, bankAccountId);
    await this.healOrphanedMatches(company, bankAccountId);

    const unmatched = await this.prisma.bankStatementLine.findMany({
      where: {
        companyId: company.companyId,
        bankAccountId,
        status: BankStatementLineStatus.UNMATCHED,
      },
      orderBy: { bookingDate: 'asc' },
    });
    if (unmatched.length === 0) return [];

    const statementLines: MatchableStatementLine[] = unmatched.map((line) => ({
      id: line.id,
      bookingDate: line.bookingDate,
      amount: line.amount.toString(),
      label: line.label,
    }));

    const bookingDates = unmatched.map((l) => l.bookingDate.getTime());
    const windowMs = DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const gte = new Date(Math.min(...bookingDates) - windowMs);
    const lte = new Date(Math.max(...bookingDates) + windowMs);

    const candidateRows = await this.prisma.ecritureLigne.findMany({
      where: {
        companyId: company.companyId,
        compteId: bankAccount.compteId,
        lettrage: null,
        ecriture: { ecritureDate: { gte, lte } },
      },
      include: {
        ecriture: { select: { id: true, ecritureNum: true, ecritureDate: true, libelle: true } },
      },
    });
    const candidates: CandidateLigne[] = candidateRows.map((row) => ({
      id: row.id,
      ecritureId: row.ecriture.id,
      ecritureNum: row.ecriture.ecritureNum,
      ecritureDate: row.ecriture.ecritureDate,
      libelle: row.ecriture.libelle,
      debit: row.debit.toString(),
      credit: row.credit.toString(),
    }));

    return matchStatementLines(statementLines, candidates);
  }

  async confirmMatch(
    company: CompanyContext,
    statementLineId: string,
    ecritureLigneId: string,
  ): Promise<void> {
    const statementLine = await this.requireUnmatchedStatementLine(company, statementLineId);
    const ligne = await this.prisma.ecritureLigne.findFirst({
      where: {
        id: ecritureLigneId,
        companyId: company.companyId,
        compteId: statementLine.bankAccount.compteId,
      },
    });
    if (!ligne) {
      throw new NotFoundException(
        `Écriture ligne ${ecritureLigneId} not found on this bank account`,
      );
    }
    if (ligne.lettrage) {
      throw new ConflictException('Cette ligne est déjà lettrée.');
    }

    const code = await this.nextLettrageCode(company);
    await this.entries.setLettrage(company, ecritureLigneId, code);
    await this.prisma.bankStatementLine.update({
      where: { id: statementLineId },
      data: { status: BankStatementLineStatus.CONFIRMED, matchedLigneId: ecritureLigneId },
    });
  }

  async clearMatch(company: CompanyContext, statementLineId: string): Promise<void> {
    const statementLine = await this.prisma.bankStatementLine.findFirst({
      where: { id: statementLineId, companyId: company.companyId },
    });
    if (!statementLine) {
      throw new NotFoundException(`Statement line ${statementLineId} not found`);
    }
    if (
      statementLine.status !== BankStatementLineStatus.CONFIRMED ||
      !statementLine.matchedLigneId
    ) {
      throw new ConflictException("Cette ligne n'est pas actuellement rapprochée.");
    }

    await this.entries.setLettrage(company, statementLine.matchedLigneId, null);
    await this.prisma.bankStatementLine.update({
      where: { id: statementLineId },
      data: { status: BankStatementLineStatus.UNMATCHED, matchedLigneId: null },
    });
  }

  async ignore(company: CompanyContext, statementLineId: string, reason?: string): Promise<void> {
    const statementLine = await this.requireUnmatchedStatementLine(company, statementLineId);
    await this.prisma.bankStatementLine.update({
      where: { id: statementLine.id },
      data: { status: BankStatementLineStatus.IGNORED, ignoredReason: reason },
    });
  }

  /**
   * Creates a real écriture through the ORDINARY EntriesService.create()
   * path — no privileged write — then auto-confirms the match against
   * whichever of the new écriture's own lines actually posted to this
   * bank account. Refuses (naming the count) if the created écriture
   * doesn't touch the bank account exactly once — a caller error (the
   * form the human filled in didn't actually include the bank line),
   * not something to silently skip.
   */
  async createEcritureFromLine(
    company: CompanyContext,
    statementLineId: string,
    dto: CreateEcritureDto,
  ): Promise<EcritureWriteResult> {
    const statementLine = await this.requireUnmatchedStatementLine(company, statementLineId);
    const result = await this.entries.create(company, dto);

    const bankLignes = result.lignes.filter(
      (l) => l.compteId === statementLine.bankAccount.compteId,
    );
    if (bankLignes.length !== 1) {
      throw new BadRequestException(
        `L'écriture doit toucher le compte bancaire ${statementLine.bankAccount.compteId} exactement une fois ` +
          `(trouvé ${bankLignes.length} fois) pour être rapprochée automatiquement avec cette ligne de relevé.`,
      );
    }

    const code = await this.nextLettrageCode(company);
    await this.entries.setLettrage(company, bankLignes[0].id, code);
    await this.prisma.bankStatementLine.update({
      where: { id: statementLineId },
      data: { status: BankStatementLineStatus.CONFIRMED, matchedLigneId: bankLignes[0].id },
    });

    return result;
  }

  private async requireBankAccount(company: CompanyContext, bankAccountId: string) {
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, companyId: company.companyId },
    });
    if (!bankAccount) {
      throw new NotFoundException(`Bank account ${bankAccountId} not found`);
    }
    return bankAccount;
  }

  private async requireUnmatchedStatementLine(company: CompanyContext, statementLineId: string) {
    const statementLine = await this.prisma.bankStatementLine.findFirst({
      where: { id: statementLineId, companyId: company.companyId },
      include: { bankAccount: true },
    });
    if (!statementLine) {
      throw new NotFoundException(`Statement line ${statementLineId} not found`);
    }
    if (statementLine.status !== BankStatementLineStatus.UNMATCHED) {
      throw new ConflictException(
        `Cette ligne de relevé n'est plus en attente (statut: ${statementLine.status}).`,
      );
    }
    return statementLine;
  }

  /**
   * A distinct "R{n}" namespace (never a plain "A1"-style code, which
   * this app's own manual lettrage already uses) so a bank-confirmed
   * match is never confused with — or collides with — a manually-typed
   * lettrage code. Sequential per company across all bank accounts.
   */
  private async nextLettrageCode(company: CompanyContext): Promise<string> {
    const rows = await this.prisma.ecritureLigne.findMany({
      where: { companyId: company.companyId, lettrage: { startsWith: LETTRAGE_PREFIX } },
      select: { lettrage: true },
    });
    const max = rows.reduce((highest, row) => {
      const match = /^R(\d+)$/.exec(row.lettrage ?? '');
      const value = match ? Number(match[1]) : 0;
      return Math.max(highest, value);
    }, 0);
    return `${LETTRAGE_PREFIX}${max + 1}`;
  }
}

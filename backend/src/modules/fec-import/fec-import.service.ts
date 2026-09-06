import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Account, ImportBatch, Journal, JournalType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import { resolvePcgClass } from '../../common/pcg/resolve-pcg-class';
import { ImportedFecFile, RawFecRecord, parseFecFile } from './fec-file-parser';
import {
  FecImportFiscalYearPlanDto,
  FecImportPreviewEcritureDto,
  FecImportPreviewResponseDto,
} from './dto/fec-import-preview-response.dto';

/** A real FEC file can have many écritures — the preview shows a bounded sample; confirm() always processes every one. */
const PREVIEW_SAMPLE_SIZE = 200;
/** Generous — a large FEC file's nested écriture/ligne creation is many sequential inserts, not one batch. */
const IMPORT_TRANSACTION_TIMEOUT_MS = 120_000;

interface ParsedFecLine {
  rowNumber: number;
  journalCode: string;
  journalLib: string;
  /** The file's own EcritureNum — a within-file grouping key only, never this app's own `Ecriture.ecritureNum` (always assigned at validation, per CLAUDE.md "Ledger integrity"). */
  sourceEcritureNum: string;
  ecritureDate: Date;
  compteNum: string;
  compteLib: string;
  compAuxNum: string | null;
  compAuxLib: string | null;
  pieceRef: string | null;
  pieceDate: Date | null;
  libelle: string;
  debit: Money;
  credit: Money;
  lettrage: string | null;
  dateLettrage: Date | null;
  montantDevise: Money | null;
  idDevise: string | null;
}

interface ValidGroupLigne {
  compteNum: string;
  compteLib: string;
  compAuxNum: string | null;
  debit: Money;
  credit: Money;
  lettrage: string | null;
  dateLettrage: Date | null;
  montantDevise: Money | null;
  idDevise: string | null;
}

interface ValidGroup {
  key: string;
  journalCode: string;
  sourceEcritureNum: string;
  ecritureDate: Date;
  libelle: string;
  pieceRef: string | null;
  pieceDate: Date | null;
  total: Money;
  lignes: ValidGroupLigne[];
}

interface RejectedGroup {
  journalCode: string;
  sourceEcritureNum: string;
  errors: string[];
}

interface PlannedJournal {
  label: string;
  inferredType: JournalType;
  typeConfident: boolean;
}

interface PlannedAccount {
  label: string;
  pcgClass: number;
  isAuxiliary: boolean;
  parentNumber: string | null;
}

interface ResolutionPlan {
  journalsToCreate: Map<string, PlannedJournal>;
  accountsToCreate: Map<string, PlannedAccount>;
  existingJournalsByCode: Map<string, Journal>;
  existingAccountsByNumber: Map<string, Account>;
}

/**
 * Infers a JournalType from common French accounting-software code/label
 * conventions (AC/ACH → achats, VE/VT → ventes, BQ/BAN → banque, CA/CAI →
 * caisse, AN → à-nouveau, OD → opérations diverses) — a best-effort
 * guess, never a guarantee, since FEC itself has no journal-TYPE column
 * at all (JournalType is this app's own concept). `confident: false`
 * (the OPERATIONS_DIVERSES fallback for anything unrecognized) is
 * surfaced in the preview so a human can review before confirming — see
 * CLAUDE.md "FEC import".
 */
function inferJournalType(code: string, label: string): { type: JournalType; confident: boolean } {
  const c = code.trim().toUpperCase();
  const l = label.trim().toUpperCase();
  if (/^(AC|ACH)/.test(c) || l.includes('ACHAT'))
    return { type: JournalType.ACHATS, confident: true };
  if (/^(VE|VT)/.test(c) || l.includes('VENTE'))
    return { type: JournalType.VENTES, confident: true };
  if (/^(BQ|BAN|BNQ)/.test(c) || l.includes('BANQUE'))
    return { type: JournalType.BANQUE, confident: true };
  if (/^(CA|CAI)/.test(c) || l.includes('CAISSE'))
    return { type: JournalType.CAISSE, confident: true };
  if (/^AN/.test(c) || l.includes('NOUVEAU'))
    return { type: JournalType.A_NOUVEAU, confident: true };
  if (/^OD/.test(c) || l.includes('DIVERS'))
    return { type: JournalType.OPERATIONS_DIVERSES, confident: true };
  return { type: JournalType.OPERATIONS_DIVERSES, confident: false };
}

/**
 * Imports a company's own chart of accounts + journals + écritures from
 * a FEC (Fichier des Écritures Comptables) file — `.txt` (Article A47
 * A-1 du LPF's own pipe-delimited convention), `.csv`, or `.xlsx`. See
 * CLAUDE.md "FEC import" for the full design; the load-bearing decisions
 * (all confirmed via AskUserQuestion before any code was written):
 *
 * - **Accounts and journals referenced by the file but missing from this
 *   company are CREATED**, not rejected the way import-excel.service.ts
 *   rejects an unknown CompteNum/JournalCode — that's the whole point of
 *   a FEC import (bootstrapping a company's books from an external
 *   export), unlike Excel import (adding entries to an already-set-up
 *   company).
 * - **Every posted écriture is a DRAFT, always** — `validatedAt`/
 *   `ecritureNum` are never set here, regardless of the source file's
 *   own ValidDate column, so the user reviews and validates through the
 *   normal journal-grid flow afterward.
 * - **A fiscal year covering the file's own date range is
 *   auto-created** if none already does — see `resolveFiscalYearPlan()`.
 *   A range that PARTIALLY (not fully) overlaps an existing fiscal year
 *   refuses the whole import rather than guessing which one it belongs
 *   to.
 * - **All-or-nothing**, same discipline as Excel/CSV-bank import: any
 *   parse error, unbalanced écriture, unclassifiable account number, or
 *   fiscal-year conflict blocks the ENTIRE confirm — never a partial
 *   import silently skipping the bad rows.
 */
@Injectable()
export class FecImportService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(
    company: CompanyContext,
    file: ImportedFecFile,
  ): Promise<FecImportPreviewResponseDto> {
    const parsed = await parseFecFile(file);
    if ('fileErrors' in parsed) {
      return this.emptyResponse(parsed.fileErrors);
    }

    const { lines, lineErrors } = this.parseLines(parsed.records);
    if (lineErrors.length > 0) {
      return this.emptyResponse(lineErrors);
    }

    const { valid, rejected } = this.groupAndValidate(lines);

    const { plan, errors: planErrors } = await this.buildResolutionPlan(company, lines);
    if (planErrors.length > 0) {
      return this.emptyResponse(planErrors);
    }

    const fiscalYearPlan = await this.resolveFiscalYearPlan(company, valid);
    if ('error' in fiscalYearPlan) {
      return this.emptyResponse([fiscalYearPlan.error]);
    }

    const duplicateOf = await this.findDuplicates(company, valid);
    const sample = valid.slice(0, PREVIEW_SAMPLE_SIZE);

    return {
      fileErrors: [],
      fiscalYearPlan,
      journalsToCreate: [...plan.journalsToCreate.entries()].map(([code, info]) => ({
        code,
        label: info.label,
        inferredType: info.inferredType,
        typeConfident: info.typeConfident,
      })),
      accountsToCreate: [...plan.accountsToCreate.entries()].map(([number, info]) => ({
        number,
        label: info.label,
        pcgClass: info.pcgClass,
        isAuxiliary: info.isAuxiliary,
        parentNumber: info.parentNumber,
      })),
      toImport: sample.map((group) => this.toPreviewEcriture(group, duplicateOf.get(group.key))),
      totalEcrituresCount: valid.length,
      truncated: valid.length > sample.length,
      rejected: rejected.map((r) => ({
        journalCode: r.journalCode,
        sourceEcritureNum: r.sourceEcritureNum,
        errors: r.errors,
      })),
    };
  }

  async confirmImport(company: CompanyContext, file: ImportedFecFile): Promise<ImportBatch> {
    const parsed = await parseFecFile(file);
    if ('fileErrors' in parsed) {
      await this.persistFailedBatch(company, file.originalname, parsed.fileErrors);
      throw new BadRequestException({ message: 'Import failed', errors: parsed.fileErrors });
    }

    const { lines, lineErrors } = this.parseLines(parsed.records);
    if (lineErrors.length > 0) {
      await this.persistFailedBatch(company, file.originalname, lineErrors);
      throw new BadRequestException({ message: 'Import failed', errors: lineErrors });
    }

    const { valid, rejected } = this.groupAndValidate(lines);
    if (rejected.length > 0) {
      const errors = rejected.flatMap((g) => g.errors);
      await this.persistFailedBatch(company, file.originalname, errors);
      throw new BadRequestException({ message: 'Import failed', errors });
    }

    const { plan, errors: planErrors } = await this.buildResolutionPlan(company, lines);
    if (planErrors.length > 0) {
      await this.persistFailedBatch(company, file.originalname, planErrors);
      throw new BadRequestException({ message: 'Import failed', errors: planErrors });
    }

    const fiscalYearPlan = await this.resolveFiscalYearPlan(company, valid);
    if ('error' in fiscalYearPlan) {
      await this.persistFailedBatch(company, file.originalname, [fiscalYearPlan.error]);
      throw new ConflictException(fiscalYearPlan.error);
    }

    return this.persist(company, file.originalname, valid, plan, fiscalYearPlan);
  }

  // ---------------------------------------------------------------------
  // Parsing (raw record -> typed line)
  // ---------------------------------------------------------------------

  private parseLines(records: RawFecRecord[]): { lines: ParsedFecLine[]; lineErrors: string[] } {
    const lines: ParsedFecLine[] = [];
    const lineErrors: string[] = [];
    for (const record of records) {
      try {
        lines.push(this.parseLine(record));
      } catch (error) {
        lineErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
    return { lines, lineErrors };
  }

  private parseLine(r: RawFecRecord): ParsedFecLine {
    if (!r.journalCode || !r.ecritureNum || !r.compteNum || !r.ecritureLib) {
      throw new Error(
        `Ligne ${r.rowNumber} : JournalCode, EcritureNum, CompteNum et EcritureLib sont obligatoires.`,
      );
    }
    return {
      rowNumber: r.rowNumber,
      journalCode: r.journalCode,
      journalLib: r.journalLib || r.journalCode,
      sourceEcritureNum: r.ecritureNum,
      ecritureDate: this.parseFecDate(r.ecritureDateRaw, r.rowNumber, 'EcritureDate'),
      compteNum: r.compteNum,
      compteLib: r.compteLib || r.compteNum,
      compAuxNum: r.compAuxNum || null,
      compAuxLib: r.compAuxNum ? r.compAuxLib || r.compAuxNum : null,
      pieceRef: r.pieceRef || null,
      pieceDate: r.pieceDateRaw
        ? this.parseFecDate(r.pieceDateRaw, r.rowNumber, 'PieceDate')
        : null,
      libelle: r.ecritureLib,
      debit: this.parseFecAmount(r.debitRaw, r.rowNumber, 'Debit'),
      credit: this.parseFecAmount(r.creditRaw, r.rowNumber, 'Credit'),
      lettrage: r.ecritureLet || null,
      dateLettrage: r.dateLetRaw ? this.parseFecDate(r.dateLetRaw, r.rowNumber, 'DateLet') : null,
      montantDevise: r.montantDeviseRaw
        ? this.parseFecAmount(r.montantDeviseRaw, r.rowNumber, 'Montantdevise')
        : null,
      idDevise: r.idDevise || null,
    };
  }

  /** AAAAMMJJ per Article A47 A-1 du LPF §XII, plus common real-world variants (ISO, DD/MM/YYYY). */
  private parseFecDate(raw: string, rowNumber: number, columnName: string): Date {
    const trimmed = raw.trim();
    if (/^\d{8}$/.test(trimmed)) {
      const iso = `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
      const date = new Date(iso);
      if (!Number.isNaN(date.getTime())) return date;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      const date = new Date(trimmed.slice(0, 10));
      if (!Number.isNaN(date.getTime())) return date;
    }
    const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(trimmed);
    if (slash) {
      const [, d, m, y] = slash;
      const date = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
      if (!Number.isNaN(date.getTime())) return date;
    }
    throw new Error(`Ligne ${rowNumber} : "${columnName}" n'est pas une date valide ("${raw}").`);
  }

  /** Decimal comma per Article A47 A-1 du LPF §XII, but a decimal point is also accepted (real files vary). */
  private parseFecAmount(raw: string, rowNumber: number, columnName: string): Money {
    const trimmed = raw.trim();
    if (trimmed === '') return Money.zero();
    let normalized = trimmed.replace(/\s/g, '');
    if (normalized.includes(',') && normalized.includes('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else if (normalized.includes(',')) {
      normalized = normalized.replace(',', '.');
    }
    try {
      return Money.fromString(normalized);
    } catch {
      throw new Error(
        `Ligne ${rowNumber} : "${columnName}" n'est pas un montant valide ("${raw}").`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // Grouping (JournalCode+EcritureNum, since a per-journal numbering
  // scheme can legitimately repeat EcritureNum across different journals)
  // ---------------------------------------------------------------------

  private groupAndValidate(lines: ParsedFecLine[]): {
    valid: ValidGroup[];
    rejected: RejectedGroup[];
  } {
    const groups = new Map<string, ParsedFecLine[]>();
    for (const line of lines) {
      const key = `${line.journalCode} ${line.sourceEcritureNum}`;
      const group = groups.get(key) ?? [];
      group.push(line);
      groups.set(key, group);
    }

    const valid: ValidGroup[] = [];
    const rejected: RejectedGroup[] = [];
    for (const [key, groupLines] of groups) {
      const result = this.buildGroup(key, groupLines);
      if ('errors' in result) {
        rejected.push(result.errors);
      } else {
        valid.push(result.group);
      }
    }
    return { valid, rejected };
  }

  private buildGroup(
    key: string,
    groupLines: ParsedFecLine[],
  ): { group: ValidGroup } | { errors: RejectedGroup } {
    const first = groupLines[0];
    const lineErrors: string[] = [];
    let totalDebit = Money.zero();
    let totalCredit = Money.zero();
    const lignes: ValidGroupLigne[] = [];

    for (const line of groupLines) {
      if (!line.debit.isZero() && !line.credit.isZero()) {
        lineErrors.push(
          `Ligne ${line.rowNumber} : une ligne ne peut avoir à la fois un débit et un crédit.`,
        );
        continue;
      }
      if (line.debit.isZero() && line.credit.isZero()) {
        lineErrors.push(`Ligne ${line.rowNumber} : une ligne doit avoir un débit ou un crédit.`);
        continue;
      }
      totalDebit = totalDebit.plus(line.debit);
      totalCredit = totalCredit.plus(line.credit);
      lignes.push({
        compteNum: line.compteNum,
        compteLib: line.compteLib,
        compAuxNum: line.compAuxNum,
        debit: line.debit,
        credit: line.credit,
        lettrage: line.lettrage,
        dateLettrage: line.dateLettrage,
        montantDevise: line.montantDevise,
        idDevise: line.idDevise,
      });
    }

    if (lineErrors.length > 0) {
      return {
        errors: {
          journalCode: first.journalCode,
          sourceEcritureNum: first.sourceEcritureNum,
          errors: lineErrors,
        },
      };
    }
    if (!totalDebit.equals(totalCredit)) {
      return {
        errors: {
          journalCode: first.journalCode,
          sourceEcritureNum: first.sourceEcritureNum,
          errors: [
            `Écriture ${first.journalCode}/${first.sourceEcritureNum} déséquilibrée : ` +
              `débit ${totalDebit.toApiString()} ≠ crédit ${totalCredit.toApiString()}.`,
          ],
        },
      };
    }

    return {
      group: {
        key,
        journalCode: first.journalCode,
        sourceEcritureNum: first.sourceEcritureNum,
        ecritureDate: first.ecritureDate,
        libelle: first.libelle,
        pieceRef: first.pieceRef,
        pieceDate: first.pieceDate,
        total: totalDebit,
        lignes,
      },
    };
  }

  // ---------------------------------------------------------------------
  // Resolution planning — which journals/accounts already exist vs. need
  // creating. Built from the FLAT line list (not the grouped écritures),
  // since accounts/journals are file-wide facts, not per-écriture ones.
  // ---------------------------------------------------------------------

  private async buildResolutionPlan(
    company: CompanyContext,
    lines: ParsedFecLine[],
  ): Promise<{ plan: ResolutionPlan; errors: string[] }> {
    const [existingJournals, existingAccounts] = await Promise.all([
      this.prisma.journal.findMany({ where: { companyId: company.companyId } }),
      this.prisma.account.findMany({ where: { companyId: company.companyId } }),
    ]);
    const existingJournalsByCode = new Map(existingJournals.map((j) => [j.code, j]));
    const existingAccountsByNumber = new Map(existingAccounts.map((a) => [a.number, a]));

    const journalsToCreate = new Map<string, PlannedJournal>();
    const accountsToCreate = new Map<string, PlannedAccount>();
    const errors: string[] = [];
    const erredAccountNumbers = new Set<string>();

    const resolveClassOrError = (number: string): number | null => {
      try {
        return resolvePcgClass(number);
      } catch (error) {
        if (!erredAccountNumbers.has(number)) {
          erredAccountNumbers.add(number);
          errors.push(error instanceof Error ? error.message : String(error));
        }
        return null;
      }
    };

    for (const line of lines) {
      if (
        !existingJournalsByCode.has(line.journalCode) &&
        !journalsToCreate.has(line.journalCode)
      ) {
        const { type, confident } = inferJournalType(line.journalCode, line.journalLib);
        journalsToCreate.set(line.journalCode, {
          label: line.journalLib,
          inferredType: type,
          typeConfident: confident,
        });
      }

      if (!existingAccountsByNumber.has(line.compteNum)) {
        const existingPlan = accountsToCreate.get(line.compteNum);
        if (existingPlan?.isAuxiliary) {
          errors.push(
            `Le compte "${line.compteNum}" est utilisé à la fois comme compte principal et comme ` +
              `compte auxiliaire (CompAuxNum) ailleurs dans le fichier.`,
          );
        } else if (!existingPlan) {
          const pcgClass = resolveClassOrError(line.compteNum);
          if (pcgClass !== null) {
            accountsToCreate.set(line.compteNum, {
              label: line.compteLib,
              pcgClass,
              isAuxiliary: false,
              parentNumber: null,
            });
          }
        }
      }

      if (line.compAuxNum && !existingAccountsByNumber.has(line.compAuxNum)) {
        const existingPlan = accountsToCreate.get(line.compAuxNum);
        if (
          existingPlan &&
          (!existingPlan.isAuxiliary || existingPlan.parentNumber !== line.compteNum)
        ) {
          errors.push(
            `Le compte auxiliaire "${line.compAuxNum}" apparaît sous plusieurs comptes collectifs ` +
              `différents (ou aussi comme compte principal) dans le fichier.`,
          );
        } else if (!existingPlan) {
          // An auxiliary account's pcgClass is always inherited from its
          // parent collectif's OWN leading digit — CompAuxNum is often an
          // arbitrary alphanumeric identifier (e.g. "CLIENT01"), not a
          // PCG-shaped number, so it is never itself passed through
          // resolvePcgClass(). Matches AccountsService.createTiers()'s
          // own `pcgClass: parent.pcgClass` convention.
          const parentPcgClass = resolveClassOrError(line.compteNum);
          if (parentPcgClass !== null) {
            accountsToCreate.set(line.compAuxNum, {
              label: line.compAuxLib ?? line.compAuxNum,
              pcgClass: parentPcgClass,
              isAuxiliary: true,
              parentNumber: line.compteNum,
            });
          }
        }
      }
    }

    return {
      plan: {
        journalsToCreate,
        accountsToCreate,
        existingJournalsByCode,
        existingAccountsByNumber,
      },
      errors,
    };
  }

  // ---------------------------------------------------------------------
  // Fiscal year resolution — see CLAUDE.md "FEC import" for the
  // full-containment / partial-overlap / no-overlap decision tree
  // (confirmed via AskUserQuestion: auto-create when nothing covers it).
  // ---------------------------------------------------------------------

  private async resolveFiscalYearPlan(
    company: CompanyContext,
    valid: ValidGroup[],
  ): Promise<FecImportFiscalYearPlanDto | { error: string }> {
    if (valid.length === 0) {
      return {
        error: 'Aucune écriture valide dans le fichier — impossible de déterminer un exercice.',
      };
    }
    const dates = valid.map((g) => g.ecritureDate.getTime());
    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));

    const fiscalYears = await this.prisma.fiscalYear.findMany({
      where: { companyId: company.companyId },
    });

    const fullyContaining = fiscalYears.find((fy) => fy.startDate <= min && max <= fy.endDate);
    if (fullyContaining) {
      return {
        action: 'REUSE_EXISTING',
        fiscalYearId: fullyContaining.id,
        label: fullyContaining.label,
        startDate: fullyContaining.startDate.toISOString().slice(0, 10),
        endDate: fullyContaining.endDate.toISOString().slice(0, 10),
      };
    }

    const partiallyOverlapping = fiscalYears.find((fy) => fy.startDate <= max && min <= fy.endDate);
    if (partiallyOverlapping) {
      return {
        error:
          `La période du fichier (${min.toISOString().slice(0, 10)} → ${max.toISOString().slice(0, 10)}) ` +
          `chevauche partiellement l'exercice existant « ${partiallyOverlapping.label} » ` +
          `(${partiallyOverlapping.startDate.toISOString().slice(0, 10)} → ` +
          `${partiallyOverlapping.endDate.toISOString().slice(0, 10)}) sans y être entièrement comprise — ` +
          `création automatique refusée, résolvez le conflit manuellement (exercices) avant de réessayer.`,
      };
    }

    const label = await this.nextFiscalYearLabel(company, min, max);
    return {
      action: 'CREATE_NEW',
      label,
      startDate: min.toISOString().slice(0, 10),
      endDate: max.toISOString().slice(0, 10),
    };
  }

  private async nextFiscalYearLabel(
    company: CompanyContext,
    min: Date,
    max: Date,
  ): Promise<string> {
    const minYear = min.getUTCFullYear();
    const maxYear = max.getUTCFullYear();
    const base = minYear === maxYear ? `Import FEC ${minYear}` : `Import FEC ${minYear}-${maxYear}`;
    const existingLabels = new Set(
      (
        await this.prisma.fiscalYear.findMany({
          where: { companyId: company.companyId },
          select: { label: true },
        })
      ).map((fy) => fy.label),
    );
    if (!existingLabels.has(base)) return base;
    let suffix = 2;
    while (existingLabels.has(`${base} (${suffix})`)) suffix += 1;
    return `${base} (${suffix})`;
  }

  // ---------------------------------------------------------------------
  // Duplicate detection — preview-only warning, never blocks confirm()
  // (same discipline as ImportExcelService.findDuplicates()), keyed by
  // account NUMBER rather than id since some accounts don't exist yet.
  // ---------------------------------------------------------------------

  private async findDuplicates(
    company: CompanyContext,
    groups: ValidGroup[],
  ): Promise<Map<string, string>> {
    const existing = await this.prisma.ecriture.findMany({
      where: { companyId: company.companyId },
      include: { lignes: { include: { compte: true } }, journal: true },
    });

    const existingBySignature = new Map<string, string | null>();
    for (const ecriture of existing) {
      const signature = this.buildSignature(
        ecriture.journal.code,
        ecriture.ecritureDate,
        ecriture.lignes.map((l) => ({
          compteNum: l.compte.number,
          debit: Money.fromDecimal(l.debit),
          credit: Money.fromDecimal(l.credit),
        })),
      );
      if (!existingBySignature.has(signature)) {
        existingBySignature.set(signature, ecriture.ecritureNum);
      }
    }

    const duplicateOf = new Map<string, string>();
    const seenInFile = new Map<string, string>();
    for (const group of groups) {
      const signature = this.buildSignature(group.journalCode, group.ecritureDate, group.lignes);
      if (existingBySignature.has(signature)) {
        const ecritureNum = existingBySignature.get(signature);
        duplicateOf.set(
          group.key,
          ecritureNum ? `écriture existante n°${ecritureNum}` : 'écriture existante (brouillon)',
        );
        continue;
      }
      const fileMatch = seenInFile.get(signature);
      if (fileMatch) {
        duplicateOf.set(group.key, `doublon dans le fichier (EcritureNum "${fileMatch}")`);
      } else {
        seenInFile.set(signature, group.sourceEcritureNum);
      }
    }
    return duplicateOf;
  }

  private buildSignature(
    journalCode: string,
    ecritureDate: Date,
    lignes: { compteNum: string; debit: Money; credit: Money }[],
  ): string {
    const dateKey = ecritureDate.toISOString().slice(0, 10);
    const lineKeys = lignes
      .map((l) => `${l.compteNum}:${l.debit.toApiString()}:${l.credit.toApiString()}`)
      .sort();
    return `${journalCode}|${dateKey}|${lineKeys.join(';')}`;
  }

  // ---------------------------------------------------------------------
  // Preview shaping / persistence
  // ---------------------------------------------------------------------

  private toPreviewEcriture(
    group: ValidGroup,
    duplicateOf: string | undefined,
  ): FecImportPreviewEcritureDto {
    return {
      journalCode: group.journalCode,
      sourceEcritureNum: group.sourceEcritureNum,
      ecritureDate: group.ecritureDate.toISOString().slice(0, 10),
      libelle: group.libelle,
      pieceRef: group.pieceRef,
      total: group.total.toApiString(),
      lignes: group.lignes.map((l) => ({
        compteNum: l.compteNum,
        compteLib: l.compteLib,
        compAuxNum: l.compAuxNum,
        debit: l.debit.toApiString(),
        credit: l.credit.toApiString(),
      })),
      isDuplicate: Boolean(duplicateOf),
      duplicateOf,
    };
  }

  private emptyResponse(fileErrors: string[]): FecImportPreviewResponseDto {
    return {
      fileErrors,
      fiscalYearPlan: null,
      journalsToCreate: [],
      accountsToCreate: [],
      toImport: [],
      totalEcrituresCount: 0,
      truncated: false,
      rejected: [],
    };
  }

  private async persistFailedBatch(
    company: CompanyContext,
    fileName: string,
    errors: string[],
  ): Promise<void> {
    await this.prisma.importBatch.create({
      data: { companyId: company.companyId, fileName, status: 'FAILED', errors },
    });
  }

  private async persist(
    company: CompanyContext,
    fileName: string,
    valid: ValidGroup[],
    plan: ResolutionPlan,
    fiscalYearPlan: FecImportFiscalYearPlanDto,
  ): Promise<ImportBatch> {
    return this.prisma.$transaction(
      async (tx) => {
        const fiscalYearId =
          fiscalYearPlan.action === 'REUSE_EXISTING'
            ? fiscalYearPlan.fiscalYearId!
            : (
                await tx.fiscalYear.create({
                  data: {
                    companyId: company.companyId,
                    label: fiscalYearPlan.label,
                    startDate: new Date(fiscalYearPlan.startDate),
                    endDate: new Date(fiscalYearPlan.endDate),
                  },
                })
              ).id;

        const journalIdByCode = new Map<string, string>(
          [...plan.existingJournalsByCode.entries()].map(([code, j]) => [code, j.id]),
        );
        for (const [code, info] of plan.journalsToCreate) {
          const created = await tx.journal.create({
            data: {
              companyId: company.companyId,
              code,
              label: info.label,
              type: info.inferredType,
            },
          });
          journalIdByCode.set(code, created.id);
        }

        const accountIdByNumber = new Map<string, string>(
          [...plan.existingAccountsByNumber.entries()].map(([num, a]) => [num, a.id]),
        );
        const toCreate = [...plan.accountsToCreate.entries()];
        // Parents (isAuxiliary: false) before children, so a new aux
        // account's parentId can always be resolved.
        for (const [number, info] of toCreate.filter(([, i]) => !i.isAuxiliary)) {
          const created = await tx.account.create({
            data: {
              companyId: company.companyId,
              number,
              label: info.label,
              pcgClass: info.pcgClass,
              isAuxiliary: false,
            },
          });
          accountIdByNumber.set(number, created.id);
        }
        for (const [number, info] of toCreate.filter(([, i]) => i.isAuxiliary)) {
          const created = await tx.account.create({
            data: {
              companyId: company.companyId,
              number,
              label: info.label,
              pcgClass: info.pcgClass,
              isAuxiliary: true,
              parentId: info.parentNumber ? accountIdByNumber.get(info.parentNumber) : undefined,
            },
          });
          accountIdByNumber.set(number, created.id);
        }

        return tx.importBatch.create({
          data: {
            companyId: company.companyId,
            fileName,
            status: 'COMMITTED',
            ecritures: {
              create: valid.map((group) => ({
                company: { connect: { id: company.companyId } },
                journal: { connect: { id: journalIdByCode.get(group.journalCode)! } },
                fiscalYear: { connect: { id: fiscalYearId } },
                ecritureDate: group.ecritureDate,
                pieceRef: group.pieceRef ?? undefined,
                pieceDate: group.pieceDate ?? undefined,
                libelle: group.libelle,
                lignes: {
                  create: group.lignes.map((ligne) => ({
                    company: { connect: { id: company.companyId } },
                    compte: { connect: { id: accountIdByNumber.get(ligne.compteNum)! } },
                    compteAux: ligne.compAuxNum
                      ? { connect: { id: accountIdByNumber.get(ligne.compAuxNum)! } }
                      : undefined,
                    debit: ligne.debit.toDecimal(),
                    credit: ligne.credit.toDecimal(),
                    lettrage: ligne.lettrage ?? undefined,
                    dateLettrage: ligne.dateLettrage ?? undefined,
                    montantDevise: ligne.montantDevise
                      ? ligne.montantDevise.toDecimal()
                      : undefined,
                    idDevise: ligne.idDevise ?? undefined,
                  })),
                },
              })),
            },
          },
          include: { ecritures: { include: { lignes: true } } },
        });
      },
      { timeout: IMPORT_TRANSACTION_TIMEOUT_MS },
    );
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Account, Ecriture, ImportBatch, Journal, Prisma } from '@prisma/client';
import ExcelJS, { Row, Worksheet } from 'exceljs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import { assertFiscalYearOpen } from '../../common/ledger/assert-fiscal-year-open';
import {
  ImportPreviewEcritureDto,
  ImportPreviewResponseDto,
} from './dto/import-preview-response.dto';

/**
 * Column headers expected on row 1 of the imported sheet. EcritureRef is a
 * purely import-time grouping key chosen by whoever built the sheet (not
 * the final EcritureNum, which is only ever assigned at validation — see
 * CLAUDE.md "Ledger integrity").
 */
const REQUIRED_COLUMNS = [
  'EcritureRef',
  'JournalCode',
  'EcritureDate',
  'CompteNum',
  'EcritureLib',
  'Debit',
  'Credit',
] as const;

/**
 * exceljs cell values can be a rich union (Date, RichText, Hyperlink,
 * formula result, ...), not just primitives — a blind `String(cell.value)`
 * risks silently producing "[object Object]". This only trusts the shapes
 * we actually expect from an accounting import sheet.
 */
function cellValueToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object' && 'text' in value) {
    return typeof value.text === 'string' ? value.text : '';
  }
  if (typeof value === 'object' && 'result' in value) {
    return typeof value.result === 'string' || typeof value.result === 'number'
      ? String(value.result)
      : '';
  }
  return '';
}

interface ParsedLine {
  rowNumber: number;
  ecritureRef: string;
  journalCode: string;
  ecritureDate: Date;
  compteNum: string;
  compteAuxNum?: string;
  libelle: string;
  pieceRef?: string;
  pieceDate?: Date;
  debit: Money;
  credit: Money;
}

export interface ImportedFile {
  originalname: string;
  buffer: Buffer;
}

interface ValidGroupLigne {
  compteId: string;
  compteNum: string;
  compteLib: string;
  debit: Money;
  credit: Money;
}

interface ValidGroup {
  ecritureRef: string;
  journalCode: string;
  ecritureDate: Date;
  libelle: string;
  pieceRef?: string;
  total: Money;
  lignes: ValidGroupLigne[];
  /** Ready for Prisma — built once here so importJournal() doesn't redo this work. */
  data: Prisma.EcritureCreateWithoutImportBatchInput;
}

interface RejectedGroup {
  ecritureRef: string;
  errors: string[];
}

/**
 * Imports a journal from an Excel sheet as draft (unvalidated) écritures,
 * so they go through the normal review/validate flow like anything entered
 * by hand. Rows are read as numbers where Excel gives numbers — the one
 * place in the codebase allowed to call `Money.fromNumber`, because Excel
 * is exactly the "source we don't control" that escape hatch exists for.
 * See CLAUDE.md "Money handling".
 */
@Injectable()
export class ImportExcelService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Parses, groups, validates, and flags suspected duplicates — a pure
   * read, writes nothing (not even an ImportBatch row). The frontend
   * confirms by re-submitting the same file to importJournal(), which
   * redoes this same work; this method never becomes "the" import, it
   * only ever previews one.
   */
  async preview(
    company: CompanyContext,
    fiscalYearId: string,
    file: ImportedFile,
  ): Promise<ImportPreviewResponseDto> {
    await this.requireOpenFiscalYear(company, fiscalYearId);

    const parsed = await this.tryParseWorkbook(file);
    if ('fileErrors' in parsed) {
      return { fileErrors: parsed.fileErrors, toImport: [], rejected: [] };
    }

    const { journalByCode, accountByNumber } = await this.loadLookups(company);
    const { valid, rejected } = this.groupAndValidate(
      parsed.lines,
      company,
      fiscalYearId,
      journalByCode,
      accountByNumber,
    );
    const duplicateOf = await this.findDuplicates(company, valid);

    return {
      fileErrors: [],
      toImport: valid.map((group) =>
        this.toPreviewEcriture(group, duplicateOf.get(group.ecritureRef)),
      ),
      rejected,
    };
  }

  /**
   * Always persists exactly one ImportBatch — COMMITTED on success, FAILED
   * (carrying the errors) otherwise — so there's a real import history
   * even when nothing could be imported. Still atomic: any error anywhere
   * in the file means nothing is imported; duplicates are preview-only
   * warnings and never block this.
   */
  async importJournal(
    company: CompanyContext,
    fiscalYearId: string,
    file: ImportedFile,
  ): Promise<ImportBatch> {
    await this.requireOpenFiscalYear(company, fiscalYearId);

    const parsed = await this.tryParseWorkbook(file);
    if ('fileErrors' in parsed) {
      await this.persistFailedBatch(company, file.originalname, parsed.fileErrors);
      throw new BadRequestException({ message: 'Import failed', errors: parsed.fileErrors });
    }

    const { journalByCode, accountByNumber } = await this.loadLookups(company);
    const { valid, rejected } = this.groupAndValidate(
      parsed.lines,
      company,
      fiscalYearId,
      journalByCode,
      accountByNumber,
    );

    if (rejected.length > 0) {
      const errors = rejected.flatMap((group) => group.errors);
      await this.persistFailedBatch(company, file.originalname, errors);
      throw new BadRequestException({ message: 'Import failed', errors });
    }

    return this.prisma.importBatch.create({
      data: {
        companyId: company.companyId,
        fileName: file.originalname,
        status: 'COMMITTED',
        ecritures: { create: valid.map((group) => group.data) },
      },
      include: { ecritures: { include: { lignes: true } } },
    });
  }

  private async requireOpenFiscalYear(
    company: CompanyContext,
    fiscalYearId: string,
  ): Promise<void> {
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId: company.companyId },
    });
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal year ${fiscalYearId} not found`);
    }
    assertFiscalYearOpen(fiscalYear);
  }

  private async loadLookups(
    company: CompanyContext,
  ): Promise<{ journalByCode: Map<string, Journal>; accountByNumber: Map<string, Account> }> {
    const [journals, accounts] = await Promise.all([
      this.prisma.journal.findMany({ where: { companyId: company.companyId } }),
      this.prisma.account.findMany({ where: { companyId: company.companyId } }),
    ]);
    return {
      journalByCode: new Map(journals.map((journal) => [journal.code, journal])),
      accountByNumber: new Map(accounts.map((account) => [account.number, account])),
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

  /**
   * Suspected duplicates: same journal + same date + same set of
   * (compteId, debit, credit) as an existing écriture (validated or
   * draft) or another group in this same file. The whole entry must be
   * structurally identical — not a line-by-line match — so a signature
   * built from all of a candidate's lines is what's compared, not
   * individual lines.
   */
  private async findDuplicates(
    company: CompanyContext,
    groups: ValidGroup[],
  ): Promise<Map<string, string>> {
    const existing = await this.prisma.ecriture.findMany({
      where: { companyId: company.companyId },
      include: { lignes: true, journal: true },
    });

    const existingBySignature = new Map<string, Ecriture>();
    for (const ecriture of existing) {
      const signature = this.buildSignature(
        ecriture.journal.code,
        ecriture.ecritureDate,
        ecriture.lignes.map((ligne) => ({
          compteId: ligne.compteId,
          debit: Money.fromDecimal(ligne.debit),
          credit: Money.fromDecimal(ligne.credit),
        })),
      );
      if (!existingBySignature.has(signature)) {
        existingBySignature.set(signature, ecriture);
      }
    }

    const duplicateOf = new Map<string, string>();
    const seenInFile = new Map<string, string>();

    for (const group of groups) {
      const signature = this.buildSignature(group.journalCode, group.ecritureDate, group.lignes);

      const existingMatch = existingBySignature.get(signature);
      if (existingMatch) {
        duplicateOf.set(
          group.ecritureRef,
          existingMatch.ecritureNum
            ? `écriture existante n°${existingMatch.ecritureNum}`
            : 'écriture existante (brouillon)',
        );
        continue;
      }

      const fileMatch = seenInFile.get(signature);
      if (fileMatch) {
        duplicateOf.set(group.ecritureRef, `doublon dans le fichier (EcritureRef "${fileMatch}")`);
      } else {
        seenInFile.set(signature, group.ecritureRef);
      }
    }

    return duplicateOf;
  }

  /**
   * A whole-entry identity key: journal + date + the sorted set of
   * (account, debit, credit) across every line. Two écritures collide
   * here only if they're structurally identical, not merely
   * line-for-line similar — matches the requirement that duplicate
   * detection compares entries as a unit.
   */
  private buildSignature(
    journalCode: string,
    ecritureDate: Date,
    lignes: { compteId: string; debit: Money; credit: Money }[],
  ): string {
    const dateKey = ecritureDate.toISOString().slice(0, 10);
    const lineKeys = lignes
      .map(
        (ligne) => `${ligne.compteId}:${ligne.debit.toApiString()}:${ligne.credit.toApiString()}`,
      )
      .sort();
    return `${journalCode}|${dateKey}|${lineKeys.join(';')}`;
  }

  private toPreviewEcriture(
    group: ValidGroup,
    duplicateOf: string | undefined,
  ): ImportPreviewEcritureDto {
    return {
      ecritureRef: group.ecritureRef,
      journalCode: group.journalCode,
      ecritureDate: group.ecritureDate.toISOString().slice(0, 10),
      libelle: group.libelle,
      pieceRef: group.pieceRef,
      total: group.total.toApiString(),
      lignes: group.lignes.map((ligne) => ({
        compteNum: ligne.compteNum,
        compteLib: ligne.compteLib,
        debit: ligne.debit.toApiString(),
        credit: ligne.credit.toApiString(),
      })),
      isDuplicate: Boolean(duplicateOf),
      duplicateOf,
    };
  }

  private groupAndValidate(
    lines: ParsedLine[],
    company: CompanyContext,
    fiscalYearId: string,
    journalByCode: Map<string, Journal>,
    accountByNumber: Map<string, Account>,
  ): { valid: ValidGroup[]; rejected: RejectedGroup[] } {
    const groups = new Map<string, ParsedLine[]>();
    for (const line of lines) {
      const group = groups.get(line.ecritureRef) ?? [];
      group.push(line);
      groups.set(line.ecritureRef, group);
    }

    const valid: ValidGroup[] = [];
    const rejected: RejectedGroup[] = [];

    for (const [ref, groupLines] of groups) {
      const result = this.buildGroup(
        ref,
        groupLines,
        company,
        fiscalYearId,
        journalByCode,
        accountByNumber,
      );
      if ('errors' in result) {
        rejected.push({ ecritureRef: ref, errors: result.errors });
      } else {
        valid.push(result.group);
      }
    }

    return { valid, rejected };
  }

  private buildGroup(
    ref: string,
    groupLines: ParsedLine[],
    company: CompanyContext,
    fiscalYearId: string,
    journalByCode: Map<string, Journal>,
    accountByNumber: Map<string, Account>,
  ): { group: ValidGroup } | { errors: string[] } {
    const errors: string[] = [];
    const distinctJournalCodes = new Set(groupLines.map((line) => line.journalCode));
    if (distinctJournalCodes.size > 1) {
      return { errors: [`EcritureRef "${ref}" mixes more than one JournalCode.`] };
    }

    const journal = journalByCode.get(groupLines[0].journalCode);
    if (!journal) {
      return {
        errors: [`EcritureRef "${ref}": unknown JournalCode "${groupLines[0].journalCode}".`],
      };
    }

    let totalDebit = Money.zero();
    let totalCredit = Money.zero();
    const lignesData: Prisma.EcritureLigneCreateWithoutEcritureInput[] = [];
    const lineSummaries: ValidGroupLigne[] = [];

    for (const line of groupLines) {
      const compte = accountByNumber.get(line.compteNum);
      if (!compte) {
        errors.push(
          `EcritureRef "${ref}" (row ${line.rowNumber}): unknown CompteNum "${line.compteNum}".`,
        );
        continue;
      }
      const compteAux = line.compteAuxNum ? accountByNumber.get(line.compteAuxNum) : undefined;
      if (line.compteAuxNum && !compteAux) {
        errors.push(
          `EcritureRef "${ref}" (row ${line.rowNumber}): unknown CompAuxNum "${line.compteAuxNum}".`,
        );
        continue;
      }
      if (!line.debit.isZero() && !line.credit.isZero()) {
        errors.push(
          `EcritureRef "${ref}" (row ${line.rowNumber}): a line cannot have both a debit and a credit.`,
        );
        continue;
      }
      if (line.debit.isZero() && line.credit.isZero()) {
        errors.push(
          `EcritureRef "${ref}" (row ${line.rowNumber}): a line must have a debit or a credit.`,
        );
        continue;
      }

      totalDebit = totalDebit.plus(line.debit);
      totalCredit = totalCredit.plus(line.credit);

      lignesData.push({
        company: { connect: { id: company.companyId } },
        compte: { connect: { id: compte.id } },
        compteAux: compteAux ? { connect: { id: compteAux.id } } : undefined,
        debit: line.debit.toDecimal(),
        credit: line.credit.toDecimal(),
      });
      lineSummaries.push({
        compteId: compte.id,
        compteNum: compte.number,
        compteLib: compte.label,
        debit: line.debit,
        credit: line.credit,
      });
    }

    if (errors.length > 0) {
      return { errors };
    }
    if (!totalDebit.equals(totalCredit)) {
      return {
        errors: [
          `EcritureRef "${ref}" does not balance: debit ${totalDebit.toApiString()} != ` +
            `credit ${totalCredit.toApiString()}.`,
        ],
      };
    }

    const first = groupLines[0];
    return {
      group: {
        ecritureRef: ref,
        journalCode: journal.code,
        ecritureDate: first.ecritureDate,
        libelle: first.libelle,
        pieceRef: first.pieceRef,
        total: totalDebit,
        lignes: lineSummaries,
        data: {
          company: { connect: { id: company.companyId } },
          journal: { connect: { id: journal.id } },
          fiscalYear: { connect: { id: fiscalYearId } },
          ecritureDate: first.ecritureDate,
          pieceRef: first.pieceRef,
          pieceDate: first.pieceDate,
          libelle: first.libelle,
          lignes: { create: lignesData },
        },
      },
    };
  }

  private async tryParseWorkbook(
    file: ImportedFile,
  ): Promise<{ lines: ParsedLine[] } | { fileErrors: string[] }> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    } catch (error) {
      return {
        fileErrors: [
          `Could not read the file as an .xlsx workbook (${
            error instanceof Error ? error.message : String(error)
          }).`,
        ],
      };
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return { fileErrors: ['The workbook has no worksheets.'] };
    }

    const header = this.readHeader(worksheet);
    if ('fileErrors' in header) {
      return header;
    }

    const { lines, errors } = this.readLines(worksheet, header.columnIndex);
    if (errors.length > 0) {
      return { fileErrors: errors };
    }
    if (lines.length === 0) {
      return { fileErrors: ['The sheet has no data rows.'] };
    }
    return { lines };
  }

  private readHeader(
    worksheet: Worksheet,
  ): { columnIndex: Map<string, number> } | { fileErrors: string[] } {
    const columnIndex = new Map<string, number>();
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      const name = cellValueToString(cell.value).trim();
      if (name) columnIndex.set(name, colNumber);
    });

    const missing = REQUIRED_COLUMNS.filter((name) => !columnIndex.has(name));
    if (missing.length > 0) {
      return {
        fileErrors: [`Missing required column(s) in the import sheet: ${missing.join(', ')}.`],
      };
    }
    return { columnIndex };
  }

  private readLines(
    worksheet: Worksheet,
    columnIndex: Map<string, number>,
  ): { lines: ParsedLine[]; errors: string[] } {
    const lines: ParsedLine[] = [];
    const errors: string[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      if (row.cellCount === 0) return;
      try {
        lines.push(this.parseRow(row, columnIndex, rowNumber));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    });

    return { lines, errors };
  }

  private parseRow(row: Row, columnIndex: Map<string, number>, rowNumber: number): ParsedLine {
    const get = (name: string): unknown => {
      const index = columnIndex.get(name);
      return index ? row.getCell(index).value : undefined;
    };

    const ecritureRef = cellValueToString(get('EcritureRef')).trim();
    const journalCode = cellValueToString(get('JournalCode')).trim();
    const compteNum = cellValueToString(get('CompteNum')).trim();
    const libelle = cellValueToString(get('EcritureLib')).trim();

    if (!ecritureRef || !journalCode || !compteNum || !libelle) {
      throw new Error(
        `Row ${rowNumber}: EcritureRef, JournalCode, CompteNum and EcritureLib are all required.`,
      );
    }

    const compteAuxNum = cellValueToString(get('CompAuxNum')).trim();
    const pieceRef = cellValueToString(get('PieceRef')).trim();

    return {
      rowNumber,
      ecritureRef,
      journalCode,
      compteNum,
      libelle,
      compteAuxNum: compteAuxNum || undefined,
      pieceRef: pieceRef || undefined,
      ecritureDate: this.parseDateCell(get('EcritureDate'), rowNumber, 'EcritureDate'),
      pieceDate: this.parseOptionalDateCell(get('PieceDate')),
      debit: this.parseMoneyCell(get('Debit'), rowNumber, 'Debit'),
      credit: this.parseMoneyCell(get('Credit'), rowNumber, 'Credit'),
    };
  }

  private parseMoneyCell(value: unknown, rowNumber: number, columnName: string): Money {
    if (value === null || value === undefined || value === '') {
      return Money.zero();
    }
    if (typeof value === 'number') {
      // Excel has no Decimal type — this is the documented escape hatch,
      // used nowhere else. Result is a Decimal from this point on.
      return Money.fromNumber(value);
    }
    if (typeof value === 'string') {
      const normalized = value.trim().replace(',', '.');
      if (normalized === '') return Money.zero();
      try {
        return Money.fromString(normalized);
      } catch {
        throw new Error(`Row ${rowNumber}: "${columnName}" is not a valid amount ("${value}").`);
      }
    }
    throw new Error(`Row ${rowNumber}: "${columnName}" is not a valid amount.`);
  }

  private parseDateCell(value: unknown, rowNumber: number, columnName: string): Date {
    const parsed = this.parseOptionalDateCell(value);
    if (!parsed) {
      throw new Error(`Row ${rowNumber}: "${columnName}" is not a valid date.`);
    }
    return parsed;
  }

  private parseOptionalDateCell(value: unknown): Date | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    if (value instanceof Date) return value;
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return undefined;
  }
}

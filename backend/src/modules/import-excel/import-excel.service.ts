import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ImportBatch, Prisma } from '@prisma/client';
import ExcelJS, { Row, Worksheet } from 'exceljs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';

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

  async importJournal(
    company: CompanyContext,
    fiscalYearId: string,
    file: ImportedFile,
  ): Promise<ImportBatch> {
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId: company.companyId },
    });
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal year ${fiscalYearId} not found`);
    }
    if (fiscalYear.closedAt) {
      throw new BadRequestException(`Fiscal year "${fiscalYear.label}" is closed.`);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BadRequestException('The workbook has no worksheets.');
    }

    const columnIndex = this.readHeader(worksheet);
    const { lines, errors: parseErrors } = this.readLines(worksheet, columnIndex);
    if (parseErrors.length > 0) {
      throw new BadRequestException({ message: 'Import failed', errors: parseErrors });
    }
    if (lines.length === 0) {
      throw new BadRequestException('The sheet has no data rows.');
    }

    const [journals, accounts] = await Promise.all([
      this.prisma.journal.findMany({ where: { companyId: company.companyId } }),
      this.prisma.account.findMany({ where: { companyId: company.companyId } }),
    ]);
    const journalByCode = new Map(journals.map((journal) => [journal.code, journal]));
    const accountByNumber = new Map(accounts.map((account) => [account.number, account]));

    const groups = new Map<string, ParsedLine[]>();
    for (const line of lines) {
      const group = groups.get(line.ecritureRef) ?? [];
      group.push(line);
      groups.set(line.ecritureRef, group);
    }

    const groupErrors: string[] = [];
    const ecrituresToCreate: Prisma.EcritureCreateWithoutImportBatchInput[] = [];

    for (const [ref, groupLines] of groups) {
      const result = this.buildEcritureFromGroup(
        ref,
        groupLines,
        company,
        fiscalYearId,
        journalByCode,
        accountByNumber,
      );
      if ('errors' in result) {
        groupErrors.push(...result.errors);
      } else {
        ecrituresToCreate.push(result.data);
      }
    }

    if (groupErrors.length > 0) {
      throw new BadRequestException({ message: 'Import failed', errors: groupErrors });
    }

    return this.prisma.importBatch.create({
      data: {
        companyId: company.companyId,
        fileName: file.originalname,
        status: 'COMMITTED',
        ecritures: { create: ecrituresToCreate },
      },
      include: { ecritures: { include: { lignes: true } } },
    });
  }

  private buildEcritureFromGroup(
    ref: string,
    groupLines: ParsedLine[],
    company: CompanyContext,
    fiscalYearId: string,
    journalByCode: Map<string, { id: string; code: string }>,
    accountByNumber: Map<string, { id: string; number: string }>,
  ): { data: Prisma.EcritureCreateWithoutImportBatchInput } | { errors: string[] } {
    const errors: string[] = [];
    const distinctJournalCodes = new Set(groupLines.map((line) => line.journalCode));
    if (distinctJournalCodes.size > 1) {
      errors.push(`EcritureRef "${ref}" mixes more than one JournalCode.`);
      return { errors };
    }

    const journal = journalByCode.get(groupLines[0].journalCode);
    if (!journal) {
      errors.push(`EcritureRef "${ref}": unknown JournalCode "${groupLines[0].journalCode}".`);
      return { errors };
    }

    let totalDebit = Money.zero();
    let totalCredit = Money.zero();
    const lignesData: Prisma.EcritureLigneCreateWithoutEcritureInput[] = [];

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
    };
  }

  private readHeader(worksheet: Worksheet): Map<string, number> {
    const columnIndex = new Map<string, number>();
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      const name = cellValueToString(cell.value).trim();
      if (name) columnIndex.set(name, colNumber);
    });

    const missing = REQUIRED_COLUMNS.filter((name) => !columnIndex.has(name));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required column(s) in the import sheet: ${missing.join(', ')}.`,
      );
    }
    return columnIndex;
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

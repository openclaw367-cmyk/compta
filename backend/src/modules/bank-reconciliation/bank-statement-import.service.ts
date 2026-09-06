import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BankStatementImport } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Camt053ParserService, ParsedStatement } from './camt053-parser.service';
import { CsvColumnMapping, CsvStatementParserService } from './csv-statement-parser.service';
import { CsvColumnsPreviewDto } from './dto/csv-columns-preview.dto';
import { StatementPreviewResponseDto } from './dto/statement-preview.dto';

/**
 * Preview-then-confirm for a CAMT.053 statement import — same two-step
 * shape as ImportExcelService (see CLAUDE.md "Bank reconciliation"):
 * preview() parses and reports, persisting nothing, not even a
 * BankStatementImport row; the confirm step re-parses the resubmitted
 * file and persists everything in one transaction. All-or-nothing, same
 * as Excel import: if any line's bankReference already exists for this
 * bank account, the whole import is refused rather than silently
 * skipping just those lines — preview() surfaces the same duplicates as
 * a warning first, so this is never a surprise at confirm time.
 */
@Injectable()
export class BankStatementImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: Camt053ParserService,
    private readonly csvParser: CsvStatementParserService,
  ) {}

  async preview(
    company: CompanyContext,
    bankAccountId: string,
    xml: string,
  ): Promise<StatementPreviewResponseDto> {
    const bankAccount = await this.requireBankAccount(company, bankAccountId);
    const parsed = this.parser.parse(xml);
    const existingReferences = await this.existingReferences(company, bankAccount.id);

    return {
      iban: parsed.iban,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      openingBalance: parsed.openingBalance,
      closingBalance: parsed.closingBalance,
      lines: parsed.lines.map((line) => ({
        ...line,
        isDuplicate: line.bankReference !== null && existingReferences.has(line.bankReference),
      })),
    };
  }

  async confirmImport(
    company: CompanyContext,
    bankAccountId: string,
    fileName: string,
    xml: string,
  ): Promise<BankStatementImport> {
    const bankAccount = await this.requireBankAccount(company, bankAccountId);
    const parsed = this.parser.parse(xml);
    const existingReferences = await this.existingReferences(company, bankAccount.id);
    this.assertNoDuplicates(parsed, existingReferences);
    return this.persistParsedStatement(company, bankAccount.id, fileName, parsed);
  }

  /** Header sniff for the CSV mapping UI — no company/bank-account context needed. */
  detectCsvColumns(csv: string): CsvColumnsPreviewDto {
    return this.csvParser.detectColumns(csv);
  }

  async previewCsv(
    company: CompanyContext,
    bankAccountId: string,
    csv: string,
    mapping: CsvColumnMapping,
  ): Promise<StatementPreviewResponseDto> {
    const bankAccount = await this.requireBankAccount(company, bankAccountId);
    const parsed = this.csvParser.parse(csv, mapping);
    const existingReferences = await this.existingReferences(company, bankAccount.id);

    return {
      iban: parsed.iban,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      openingBalance: parsed.openingBalance,
      closingBalance: parsed.closingBalance,
      lines: parsed.lines.map((line) => ({
        ...line,
        isDuplicate: line.bankReference !== null && existingReferences.has(line.bankReference),
      })),
    };
  }

  async confirmImportCsv(
    company: CompanyContext,
    bankAccountId: string,
    fileName: string,
    csv: string,
    mapping: CsvColumnMapping,
  ): Promise<BankStatementImport> {
    const bankAccount = await this.requireBankAccount(company, bankAccountId);
    const parsed = this.csvParser.parse(csv, mapping);
    const existingReferences = await this.existingReferences(company, bankAccount.id);
    this.assertNoDuplicates(parsed, existingReferences);
    return this.persistParsedStatement(company, bankAccount.id, fileName, parsed);
  }

  /**
   * The shared persistence step, extracted so a live-aggregator sync
   * (Layer 1b — see CLAUDE.md "Bank reconciliation — Layer 1b") can land
   * its own already-parsed `ParsedStatement` in the exact same
   * `BankStatementImport`/`BankStatementLine` rows a CAMT.053 upload
   * produces, with zero duplicated persistence logic. `sourceLabel` fills
   * the same `fileName` column either way — for an aggregator sync this
   * is a documented, human-readable stand-in (e.g. "Bridge — sync du
   * 2026-08-29"), never a real uploaded file name, same "a conventional
   * value, not a guess" discipline as the FEC export's own PieceRef/
   * PieceDate fallback. Dedup is free either way: whichever source
   * populates `bankReference` (the bank's own CAMT reference, or
   * Bridge's own transaction id), `assertNoDuplicates()` already keys off
   * that one field — no per-source dedup logic needed.
   *
   * Callers are responsible for having already called
   * `assertNoDuplicates()` against a FRESH `existingReferences()` read —
   * this method does not re-check, so it stays usable inside another
   * caller's own transaction/guard sequencing (Layer 1b's sync path
   * checks duplicates the same way `confirmImport()` does, immediately
   * before calling this).
   */
  async persistParsedStatement(
    company: CompanyContext,
    bankAccountId: string,
    sourceLabel: string,
    parsed: ParsedStatement,
  ): Promise<BankStatementImport> {
    return this.prisma.$transaction(async (tx) => {
      const statementImport = await tx.bankStatementImport.create({
        data: {
          companyId: company.companyId,
          bankAccountId,
          fileName: sourceLabel,
          periodStart: new Date(parsed.periodStart),
          periodEnd: new Date(parsed.periodEnd),
          openingBalance: parsed.openingBalance,
          closingBalance: parsed.closingBalance,
        },
      });
      await tx.bankStatementLine.createMany({
        data: parsed.lines.map((line) => ({
          companyId: company.companyId,
          importId: statementImport.id,
          bankAccountId,
          bookingDate: new Date(line.bookingDate),
          valueDate: line.valueDate ? new Date(line.valueDate) : undefined,
          amount: line.amount,
          label: line.label,
          bankReference: line.bankReference ?? undefined,
        })),
      });
      return statementImport;
    });
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

  /**
   * Public (not private) specifically so Layer 1b's sync path can check
   * duplicates the exact same way `confirmImport()` does, immediately
   * before calling `persistParsedStatement()` — see that method's own
   * doc comment.
   */
  async existingReferences(company: CompanyContext, bankAccountId: string): Promise<Set<string>> {
    const rows = await this.prisma.bankStatementLine.findMany({
      where: { companyId: company.companyId, bankAccountId, bankReference: { not: null } },
      select: { bankReference: true },
    });
    return new Set(rows.map((r) => r.bankReference!));
  }

  /** Public for the same reason as `existingReferences()` above. */
  assertNoDuplicates(parsed: ParsedStatement, existingReferences: Set<string>): void {
    const duplicates = parsed.lines
      .map((l) => l.bankReference)
      .filter((ref): ref is string => ref !== null && existingReferences.has(ref));
    if (duplicates.length > 0) {
      throw new ConflictException(
        `Ce relevé contient ${duplicates.length} ligne(s) déjà importée(s) pour ce compte ` +
          `(référence(s) : ${duplicates.join(', ')}) — vérifiez qu'il ne s'agit pas d'un doublon.`,
      );
    }
  }
}

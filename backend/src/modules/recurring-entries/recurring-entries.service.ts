import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RecurringEntryTemplate, RecurringEntryTemplateLine } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import { findFiscalYearContaining } from '../../common/ledger/find-fiscal-year-containing';
import { EntryValidationService } from '../entries/entry-validation.service';
import { CreateEcritureDto } from '../entries/dto/create-ecriture.dto';
import { CreateEcritureLigneDto } from '../entries/dto/create-ecriture-ligne.dto';
import { CreateRecurringEntryTemplateDto } from './dto/create-recurring-entry-template.dto';
import { RecurringEntryTemplateLineDto } from './dto/recurring-entry-template-line.dto';
import { computeNextDueDate } from './recurring-entry-schedule';

type TemplateWithLines = RecurringEntryTemplate & { lines: RecurringEntryTemplateLine[] };

export interface RecurringEntryApplicationPreview {
  dto: CreateEcritureDto;
  warnings: string[];
}

/**
 * Saved templates for a repeating écriture — see CLAUDE.md "Recurring
 * entries / templates". Applying a template NEVER persists an écriture
 * itself (previewApplication() runs the exact same EntryValidationService
 * checks propose_ecriture uses, in the same order, and returns an
 * unpersisted CreateEcritureDto for a human to review/edit/save through
 * the ORDINARY POST /entries endpoint — no privileged write path, same
 * discipline as ai-chat's ProposeToolsService).
 */
@Injectable()
export class RecurringEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: EntryValidationService,
  ) {}

  async create(company: CompanyContext, dto: CreateRecurringEntryTemplateDto) {
    await this.assertJournalBelongsToCompany(company, dto.journalId);
    await this.assertLinesValid(company, dto.lines);

    const template = await this.prisma.recurringEntryTemplate.create({
      data: {
        companyId: company.companyId,
        name: dto.name,
        journalId: dto.journalId,
        libelle: dto.libelle,
        frequency: dto.frequency,
        anchorDay: dto.anchorDay,
        anchorMonth: dto.anchorMonth,
        lines: { create: dto.lines.map((l, index) => this.lineCreateData(l, index)) },
      },
      include: { lines: { orderBy: { order: 'asc' } } },
    });
    return this.toApi(template);
  }

  async findAll(company: CompanyContext) {
    const templates = await this.prisma.recurringEntryTemplate.findMany({
      where: { companyId: company.companyId },
      include: { lines: { orderBy: { order: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    return templates.map((t) => this.toApi(t));
  }

  /** Full replace of name/journal/libellé/frequency/lines. */
  async update(company: CompanyContext, id: string, dto: CreateRecurringEntryTemplateDto) {
    await this.fetchTemplate(company, id);
    await this.assertJournalBelongsToCompany(company, dto.journalId);
    await this.assertLinesValid(company, dto.lines);

    return this.prisma.$transaction(async (tx) => {
      await tx.recurringEntryTemplateLine.deleteMany({ where: { templateId: id } });
      const updated = await tx.recurringEntryTemplate.update({
        where: { id },
        data: {
          name: dto.name,
          journalId: dto.journalId,
          libelle: dto.libelle,
          frequency: dto.frequency ?? null,
          anchorDay: dto.anchorDay ?? null,
          anchorMonth: dto.anchorMonth ?? null,
          lines: { create: dto.lines.map((l, index) => this.lineCreateData(l, index)) },
        },
        include: { lines: { orderBy: { order: 'asc' } } },
      });
      return this.toApi(updated);
    });
  }

  async remove(company: CompanyContext, id: string): Promise<void> {
    await this.fetchTemplate(company, id);
    // Pure metadata — a template never itself becomes part of the
    // ledger, unlike Journal/Account/VatRate/FiscalYear, so a real
    // hard delete is correct here (see CLAUDE.md).
    await this.prisma.recurringEntryTemplate.delete({ where: { id } });
  }

  /** Stamped right after the frontend's own POST /entries succeeds for a draft built from this template. */
  async markApplied(company: CompanyContext, id: string) {
    await this.fetchTemplate(company, id);
    const updated = await this.prisma.recurringEntryTemplate.update({
      where: { id },
      data: { lastAppliedAt: new Date() },
      include: { lines: { orderBy: { order: 'asc' } } },
    });
    return this.toApi(updated);
  }

  /**
   * Resolves the fiscal year (from applicationDate), journal, and each
   * line's account/tiers by their stored number, builds a
   * CreateEcritureDto, and runs it through the same
   * EntryValidationService checks EntriesService.create() runs — never
   * persists. A stale template (a renamed/deleted account, a date
   * outside any fiscal year) fails loud, naming the gap, exactly like a
   * human's own bad manual entry would.
   */
  async previewApplication(
    company: CompanyContext,
    id: string,
    applicationDate: string,
  ): Promise<RecurringEntryApplicationPreview> {
    const template = await this.fetchTemplate(company, id);
    const date = new Date(applicationDate);

    const fiscalYear = await findFiscalYearContaining(this.prisma, company, date);
    if (!fiscalYear) {
      throw new NotFoundException(`No fiscal year covers ${applicationDate}.`);
    }

    const journal = await this.prisma.journal.findFirst({
      where: { id: template.journalId, companyId: company.companyId },
    });
    if (!journal) {
      throw new NotFoundException(`Journal used by template "${template.name}" no longer exists.`);
    }

    const lignes: CreateEcritureLigneDto[] = [];
    for (const line of template.lines) {
      const account = await this.prisma.account.findFirst({
        where: { companyId: company.companyId, number: line.accountNumber },
      });
      if (!account) {
        throw new NotFoundException(
          `Account "${line.accountNumber}" (used by template "${template.name}") not found — ` +
            'it may have been renamed or deleted since the template was saved.',
        );
      }

      let compteAuxId: string | undefined;
      if (line.auxAccountNumber) {
        const aux = await this.prisma.account.findFirst({
          where: {
            companyId: company.companyId,
            number: line.auxAccountNumber,
            parentId: account.id,
          },
        });
        if (!aux) {
          throw new NotFoundException(
            `Tiers "${line.auxAccountNumber}" under account "${line.accountNumber}" (used by ` +
              `template "${template.name}") not found.`,
          );
        }
        compteAuxId = aux.id;
      }

      const debit = Money.fromDecimal(line.debit);
      const credit = Money.fromDecimal(line.credit);
      lignes.push({
        compteId: account.id,
        compteAuxId,
        debit: debit.isZero() ? undefined : debit.toApiString(),
        credit: credit.isZero() ? undefined : credit.toApiString(),
        vatRateId: line.vatRateId ?? undefined,
      });
    }

    const dto: CreateEcritureDto = {
      journalId: journal.id,
      fiscalYearId: fiscalYear.id,
      ecritureDate: applicationDate,
      libelle: template.libelle,
      lignes,
    };

    // Same checks EntriesService.create() runs, same order, same shared
    // service — see EntryValidationService's own doc comment.
    this.validation.buildBalancedLignes(company, dto.lignes);
    await this.validation.assertReferencesBelongToCompany(company, dto.journalId, dto.fiscalYearId);
    await this.validation.assertVatRatesBelongToCompany(company, dto.lignes);
    const warnings = await this.validation.computeOrphanedImmobilisationWarnings(
      company,
      dto.lignes,
    );

    return { dto, warnings };
  }

  private async fetchTemplate(company: CompanyContext, id: string): Promise<TemplateWithLines> {
    const template = await this.prisma.recurringEntryTemplate.findFirst({
      where: { id, companyId: company.companyId },
      include: { lines: { orderBy: { order: 'asc' } } },
    });
    if (!template) {
      throw new NotFoundException(`Recurring entry template ${id} not found`);
    }
    return template;
  }

  private async assertJournalBelongsToCompany(
    company: CompanyContext,
    journalId: string,
  ): Promise<void> {
    const journal = await this.prisma.journal.findFirst({
      where: { id: journalId, companyId: company.companyId },
    });
    if (!journal) {
      throw new NotFoundException(`Journal ${journalId} not found`);
    }
  }

  private async assertLinesValid(
    company: CompanyContext,
    lines: RecurringEntryTemplateLineDto[],
  ): Promise<void> {
    for (const line of lines) {
      const debit = Money.fromString(line.debit ?? '0.00');
      const credit = Money.fromString(line.credit ?? '0.00');
      if (!debit.isZero() && !credit.isZero()) {
        throw new BadRequestException('A line cannot have both a debit and a credit amount.');
      }
      if (debit.isZero() && credit.isZero()) {
        throw new BadRequestException('A line must have either a debit or a credit amount.');
      }
    }

    const accountNumbers = [...new Set(lines.map((l) => l.accountNumber))];
    const accounts = await this.prisma.account.findMany({
      where: { companyId: company.companyId, number: { in: accountNumbers } },
    });
    const byNumber = new Map(accounts.map((a) => [a.number, a]));
    for (const number of accountNumbers) {
      if (!byNumber.has(number)) {
        throw new NotFoundException(`Account "${number}" not found.`);
      }
    }

    for (const line of lines) {
      if (!line.auxAccountNumber) continue;
      const main = byNumber.get(line.accountNumber)!;
      const aux =
        byNumber.get(line.auxAccountNumber) ??
        (await this.prisma.account.findFirst({
          where: { companyId: company.companyId, number: line.auxAccountNumber },
        }));
      if (!aux || !aux.isAuxiliary || aux.parentId !== main.id) {
        throw new BadRequestException(
          `Tiers "${line.auxAccountNumber}" is not a valid sub-account of "${line.accountNumber}".`,
        );
      }
    }

    const vatRateIds = [
      ...new Set(lines.map((l) => l.vatRateId).filter((id): id is string => Boolean(id))),
    ];
    if (vatRateIds.length > 0) {
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

  private lineCreateData(l: RecurringEntryTemplateLineDto, index: number) {
    return {
      order: index,
      accountNumber: l.accountNumber,
      auxAccountNumber: l.auxAccountNumber,
      vatRateId: l.vatRateId,
      debit: Money.fromString(l.debit ?? '0.00').toDecimal(),
      credit: Money.fromString(l.credit ?? '0.00').toDecimal(),
    };
  }

  private toApi(template: TemplateWithLines) {
    return {
      ...template,
      lines: template.lines.map((l) => ({
        ...l,
        debit: Money.fromDecimal(l.debit).toApiString(),
        credit: Money.fromDecimal(l.credit).toApiString(),
      })),
      nextDueDate: computeNextDueDate(
        template.frequency,
        template.anchorDay,
        template.anchorMonth,
        template.lastAppliedAt,
        new Date(),
      ),
    };
  }
}

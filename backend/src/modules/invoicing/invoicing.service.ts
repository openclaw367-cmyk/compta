import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Invoice, InvoiceLine, InvoiceType, JournalType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import { EntriesService } from '../entries/entries.service';
import { CreateEcritureDto } from '../entries/dto/create-ecriture.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { FinalizeInvoiceDto } from './dto/finalize-invoice.dto';
import { buildInvoicePostingLignes } from './invoice-posting';
import {
  assertInvoiceMentionsTieToPosting,
  computeInvoiceMentions,
  InvoiceMentions,
} from './invoice-mentions';

const TVA_COLLECTEE_ACCOUNT_NUMBER = '445710';

export type InvoiceWithLines = Invoice & { lines: InvoiceLine[] };

/**
 * Invoicing — Phase A. See specs/invoicing-plan.md and
 * specs/invoicing-phase-a-implementation-spec.md for the full design.
 * DRAFT invoices are freely editable and jurisdiction-agnostic;
 * finalize() is the one gated, jurisdiction-branching step that posts a
 * real écriture through the ordinary EntriesService path — never a
 * privileged write.
 */
@Injectable()
export class InvoicingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entriesService: EntriesService,
  ) {}

  async create(company: CompanyContext, dto: CreateInvoiceDto): Promise<InvoiceWithLines> {
    const type = dto.type ?? InvoiceType.SALE;
    if (type === InvoiceType.CREDIT_NOTE) {
      if (!dto.correctsInvoiceId) {
        throw new BadRequestException('A CREDIT_NOTE must set correctsInvoiceId.');
      }
      const corrects = await this.prisma.invoice.findFirst({
        where: { id: dto.correctsInvoiceId, companyId: company.companyId },
      });
      if (!corrects) {
        throw new NotFoundException(`Invoice ${dto.correctsInvoiceId} not found`);
      }
      if (corrects.type !== InvoiceType.SALE || corrects.status !== 'FINALIZED') {
        throw new BadRequestException(
          'correctsInvoiceId must reference an existing, FINALIZED SALE invoice.',
        );
      }
    } else if (dto.correctsInvoiceId) {
      throw new BadRequestException('correctsInvoiceId is only allowed for a CREDIT_NOTE.');
    }

    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id: dto.fiscalYearId, companyId: company.companyId },
    });
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal year ${dto.fiscalYearId} not found`);
    }

    await this.assertIsClientAccount(company, dto.clientAccountId);
    await this.assertLinesReferenceCompany(company, dto.lines);

    const invoice = await this.prisma.invoice.create({
      data: {
        companyId: company.companyId,
        fiscalYearId: dto.fiscalYearId,
        type,
        correctsInvoiceId: dto.correctsInvoiceId,
        clientAccountId: dto.clientAccountId,
        lines: {
          create: dto.lines.map((l) => ({
            companyId: company.companyId,
            description: l.description,
            quantity: Money.fromString(l.quantity).toDecimal(),
            unitPriceHT: Money.fromString(l.unitPriceHT).toDecimal(),
            revenueAccountId: l.revenueAccountId,
            vatRateId: l.vatRateId,
          })),
        },
      },
      include: { lines: true },
    });
    return invoice;
  }

  /** Full replace of a DRAFT invoice's client/lines. Rejects a FINALIZED invoice. */
  async update(
    company: CompanyContext,
    id: string,
    dto: CreateInvoiceDto,
  ): Promise<InvoiceWithLines> {
    const existing = await this.findOne(company, id);
    if (existing.status !== 'DRAFT') {
      throw new ConflictException(
        'Only a DRAFT invoice can be edited — create a CREDIT_NOTE instead.',
      );
    }
    await this.assertIsClientAccount(company, dto.clientAccountId);
    await this.assertLinesReferenceCompany(company, dto.lines);

    return this.prisma.$transaction(async (tx) => {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      return tx.invoice.update({
        where: { id },
        data: {
          fiscalYearId: dto.fiscalYearId,
          clientAccountId: dto.clientAccountId,
          lines: {
            create: dto.lines.map((l) => ({
              companyId: company.companyId,
              description: l.description,
              quantity: Money.fromString(l.quantity).toDecimal(),
              unitPriceHT: Money.fromString(l.unitPriceHT).toDecimal(),
              revenueAccountId: l.revenueAccountId,
              vatRateId: l.vatRateId,
            })),
          },
        },
        include: { lines: true },
      });
    });
  }

  async findAll(company: CompanyContext): Promise<InvoiceWithLines[]> {
    return this.prisma.invoice.findMany({
      where: { companyId: company.companyId },
      include: { lines: true },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  async findOne(company: CompanyContext, id: string): Promise<InvoiceWithLines> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, companyId: company.companyId },
      include: { lines: true },
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    return invoice;
  }

  async remove(company: CompanyContext, id: string): Promise<void> {
    const invoice = await this.findOne(company, id);
    if (invoice.status !== 'DRAFT') {
      throw new ConflictException('Only a DRAFT invoice can be deleted.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.delete({ where: { id } });
    });
  }

  /**
   * The gated core. See specs/invoicing-phase-a-implementation-spec.md
   * decision 3/5. Guard-first: mentions are computed BEFORE anything is
   * posted, so an MC company (or any future jurisdiction gap) fails
   * with zero side effects — no écriture, no invoiceNumber consumed.
   */
  async finalize(
    company: CompanyContext,
    id: string,
    dto: FinalizeInvoiceDto,
  ): Promise<{ invoice: Invoice; mentions: InvoiceMentions }> {
    const invoice = await this.findOne(company, id);
    if (invoice.status !== 'DRAFT') {
      throw new ConflictException('This invoice is already finalized.');
    }
    if (invoice.lines.length === 0) {
      throw new BadRequestException('Cannot finalize an invoice with no lines.');
    }

    const companyRecord = await this.prisma.company.findFirst({ where: { id: company.companyId } });
    if (!companyRecord) {
      throw new NotFoundException(`Company ${company.companyId} not found`);
    }

    const vatRateIds = [
      ...new Set(invoice.lines.map((l) => l.vatRateId).filter((v): v is string => !!v)),
    ];
    const vatRates = await this.prisma.vatRate.findMany({
      where: { id: { in: vatRateIds }, companyId: company.companyId },
    });
    const ratePercentById = new Map(
      vatRates.map((r) => [r.id, Money.fromDecimal(r.ratePercent).toApiString()]),
    );
    for (const line of invoice.lines) {
      if (line.vatRateId && !ratePercentById.has(line.vatRateId)) {
        throw new NotFoundException(`VAT rate ${line.vatRateId} not found for this company`);
      }
    }

    let correctsInvoiceNumber: string | null = null;
    if (invoice.type === InvoiceType.CREDIT_NOTE) {
      const corrects = await this.prisma.invoice.findFirst({
        where: { id: invoice.correctsInvoiceId! },
      });
      correctsInvoiceNumber = corrects?.invoiceNumber ?? null;
    }

    // Guard: compute mentions FIRST, before any posting — throws (NotImplementedException) for
    // MC with zero side effects. See decision 5. Seller country CODE comes from
    // Company.jurisdiction ('FR'/'MC' already ARE ISO 3166-1 alpha-2 codes), never parsed from
    // Company.country (a free-text display name) — see invoice-mentions.ts's own doc comment.
    const mentions = computeInvoiceMentions(
      companyRecord.jurisdiction,
      {
        name: companyRecord.name,
        addressLine: companyRecord.addressLine,
        postalCode: companyRecord.postalCode,
        city: companyRecord.city,
        countryCode: companyRecord.jurisdiction,
        siren: companyRecord.siren,
        rci: companyRecord.rci,
        vatNumber: companyRecord.vatNumber,
      },
      {
        name: dto.clientName,
        addressLine: dto.clientAddressLine ?? null,
        postalCode: dto.clientPostalCode ?? null,
        city: dto.clientCity ?? null,
        countryCode: dto.clientCountryCode,
        sirenOrRci: dto.clientSirenOrRci ?? null,
        vatNumber: dto.clientVatNumber ?? null,
      },
      {
        invoiceNumber: String(companyRecord.nextInvoiceNum),
        invoiceDate: dto.invoiceDate,
        isCreditNote: invoice.type === InvoiceType.CREDIT_NOTE,
        correctsInvoiceNumber,
        lines: invoice.lines.map((l) => ({
          description: l.description,
          quantity: Money.fromDecimal(l.quantity).toApiString(),
          unitPriceHT: Money.fromDecimal(l.unitPriceHT).toApiString(),
          vatRatePercent: l.vatRateId ? (ratePercentById.get(l.vatRateId) ?? null) : null,
        })),
      },
    );

    const clientAccount = await this.prisma.account.findFirst({
      where: { id: invoice.clientAccountId, companyId: company.companyId },
    });
    if (!clientAccount) {
      throw new NotFoundException(`Client account ${invoice.clientAccountId} not found`);
    }
    const tvaAccount = await this.prisma.account.findFirst({
      where: { companyId: company.companyId, number: TVA_COLLECTEE_ACCOUNT_NUMBER },
    });
    if (!tvaAccount) {
      throw new NotFoundException(
        `No ${TVA_COLLECTEE_ACCOUNT_NUMBER} (TVA collectée) account exists for this company.`,
      );
    }
    const journal = await this.prisma.journal.findFirst({
      where: { companyId: company.companyId, type: JournalType.VENTES },
      orderBy: { code: 'asc' },
    });
    if (!journal) {
      throw new NotFoundException(
        'No journal des ventes (type VENTES) exists for this company — create one first.',
      );
    }

    const posting = buildInvoicePostingLignes(
      clientAccount.id,
      tvaAccount.id,
      invoice.lines.map((l) => ({
        revenueAccountId: l.revenueAccountId,
        quantity: Money.fromDecimal(l.quantity).toApiString(),
        unitPriceHT: Money.fromDecimal(l.unitPriceHT).toApiString(),
        vatRateId: l.vatRateId,
        vatRatePercent: l.vatRateId ? (ratePercentById.get(l.vatRateId) ?? null) : null,
      })),
      invoice.type === InvoiceType.CREDIT_NOTE ? 'CREDIT_NOTE' : 'SALE',
    );
    // Independent tie-out BEFORE posting — see invoice-mentions.ts's own doc comment.
    assertInvoiceMentionsTieToPosting(mentions, posting.totalTTC);

    const libellePrefix = invoice.type === InvoiceType.CREDIT_NOTE ? 'Avoir' : 'Facture';
    const ecritureDto: CreateEcritureDto = {
      journalId: journal.id,
      fiscalYearId: invoice.fiscalYearId,
      ecritureDate: dto.invoiceDate,
      libelle: `${libellePrefix} ${mentions.invoiceNumber} — ${dto.clientName}`,
      lignes: posting.lignes,
    };
    const draft = await this.entriesService.create(company, ecritureDto);
    const validated = await this.entriesService.validate(company, draft.id);

    // Assigned only now — see decision 1's accepted-risk note (same shape as
    // FixedAsset.cessionEcritureId, a two-step write, not one giant transaction).
    const finalized = await this.prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: company.companyId },
        data: { nextInvoiceNum: { increment: 1 } },
      });
      return tx.invoice.update({
        where: { id },
        data: {
          status: 'FINALIZED',
          invoiceNumber: mentions.invoiceNumber,
          invoiceDate: new Date(dto.invoiceDate),
          clientNameSnapshot: dto.clientName,
          clientAddressLineSnapshot: dto.clientAddressLine,
          clientPostalCodeSnapshot: dto.clientPostalCode,
          clientCitySnapshot: dto.clientCity,
          clientCountrySnapshot: dto.clientCountryCode,
          clientSirenOrRci: dto.clientSirenOrRci,
          clientVatNumber: dto.clientVatNumber,
          postedEcritureId: validated.id,
        },
      });
    });

    return { invoice: finalized, mentions };
  }

  /**
   * Re-derives mentions for an already-FINALIZED invoice and
   * independently verifies them against the ACTUAL posted écriture's
   * own ledger lines (not just the same InvoiceLine rows finalize()
   * already checked against each other) — the stronger, ledger-real
   * tie-out, same discipline as the Tier-3 2059-A drill-down reading
   * the real disposal écriture rather than re-deriving from FixedAsset
   * fields alone.
   */
  async getMentions(company: CompanyContext, id: string): Promise<InvoiceMentions> {
    const invoice = await this.findOne(company, id);
    if (invoice.status !== 'FINALIZED' || !invoice.postedEcritureId) {
      throw new ConflictException('Mentions are only available for a FINALIZED invoice.');
    }
    const companyRecord = await this.prisma.company.findFirst({ where: { id: company.companyId } });
    if (!companyRecord) {
      throw new NotFoundException(`Company ${company.companyId} not found`);
    }

    const vatRateIds = [
      ...new Set(invoice.lines.map((l) => l.vatRateId).filter((v): v is string => !!v)),
    ];
    const vatRates = await this.prisma.vatRate.findMany({ where: { id: { in: vatRateIds } } });
    const ratePercentById = new Map(
      vatRates.map((r) => [r.id, Money.fromDecimal(r.ratePercent).toApiString()]),
    );

    let correctsInvoiceNumber: string | null = null;
    if (invoice.type === InvoiceType.CREDIT_NOTE && invoice.correctsInvoiceId) {
      const corrects = await this.prisma.invoice.findFirst({
        where: { id: invoice.correctsInvoiceId },
      });
      correctsInvoiceNumber = corrects?.invoiceNumber ?? null;
    }

    const mentions = computeInvoiceMentions(
      companyRecord.jurisdiction,
      {
        name: companyRecord.name,
        addressLine: companyRecord.addressLine,
        postalCode: companyRecord.postalCode,
        city: companyRecord.city,
        countryCode: companyRecord.jurisdiction,
        siren: companyRecord.siren,
        rci: companyRecord.rci,
        vatNumber: companyRecord.vatNumber,
      },
      {
        name: invoice.clientNameSnapshot!,
        addressLine: invoice.clientAddressLineSnapshot,
        postalCode: invoice.clientPostalCodeSnapshot,
        city: invoice.clientCitySnapshot,
        countryCode: invoice.clientCountrySnapshot!,
        sirenOrRci: invoice.clientSirenOrRci,
        vatNumber: invoice.clientVatNumber,
      },
      {
        invoiceNumber: invoice.invoiceNumber!,
        invoiceDate: invoice.invoiceDate!.toISOString().slice(0, 10),
        isCreditNote: invoice.type === InvoiceType.CREDIT_NOTE,
        correctsInvoiceNumber,
        lines: invoice.lines.map((l) => ({
          description: l.description,
          quantity: Money.fromDecimal(l.quantity).toApiString(),
          unitPriceHT: Money.fromDecimal(l.unitPriceHT).toApiString(),
          vatRatePercent: l.vatRateId ? (ratePercentById.get(l.vatRateId) ?? null) : null,
        })),
      },
    );

    const ecriture = await this.prisma.ecriture.findFirst({
      where: { id: invoice.postedEcritureId, companyId: company.companyId },
      include: { lignes: true },
    });
    if (!ecriture) {
      throw new NotFoundException(
        `Posted écriture ${invoice.postedEcritureId} for invoice ${id} no longer exists.`,
      );
    }
    const clientSideField = invoice.type === InvoiceType.CREDIT_NOTE ? 'credit' : 'debit';
    const postedTotalTTC = ecriture.lignes
      .filter((l) => l.compteId === invoice.clientAccountId)
      .reduce(
        (sum, l) => sum.plus(Money.fromDecimal(clientSideField === 'debit' ? l.debit : l.credit)),
        Money.zero(),
      )
      .toApiString();
    assertInvoiceMentionsTieToPosting(mentions, postedTotalTTC);

    return mentions;
  }

  private async assertIsClientAccount(company: CompanyContext, accountId: string): Promise<void> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, companyId: company.companyId },
    });
    if (!account) {
      throw new NotFoundException(`Client account ${accountId} not found`);
    }
    if (!account.isAuxiliary || !account.number.startsWith('411')) {
      throw new BadRequestException(
        `Account ${account.number} is not a 411-family (Clients) auxiliary account.`,
      );
    }
  }

  private async assertLinesReferenceCompany(
    company: CompanyContext,
    lines: { revenueAccountId: string; vatRateId?: string }[],
  ): Promise<void> {
    const accountIds = [...new Set(lines.map((l) => l.revenueAccountId))];
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: accountIds }, companyId: company.companyId },
    });
    const accountsById = new Map(accounts.map((a) => [a.id, a]));
    for (const id of accountIds) {
      const account = accountsById.get(id);
      if (!account) {
        throw new NotFoundException(`Revenue account ${id} not found`);
      }
      if (account.pcgClass !== 7) {
        throw new BadRequestException(
          `Account ${account.number} is not a class-7 (produits) account.`,
        );
      }
    }

    const vatRateIds = [...new Set(lines.map((l) => l.vatRateId).filter((v): v is string => !!v))];
    if (vatRateIds.length > 0) {
      const rates = await this.prisma.vatRate.count({
        where: { id: { in: vatRateIds }, companyId: company.companyId },
      });
      if (rates !== vatRateIds.length) {
        throw new NotFoundException('One or more vatRateId values do not belong to this company.');
      }
    }
  }
}

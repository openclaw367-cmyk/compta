import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BankAggregatorLink,
  BankAggregatorLinkStatus,
  BankAggregatorProvider,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CredentialEncryptionService } from '../../common/crypto/credential-encryption.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { BankStatementImportService } from '../bank-reconciliation/bank-statement-import.service';
import { BANK_AGGREGATOR_PORT, BankAggregatorPort } from './bank-aggregator.port';
import { createBankAggregatorAdapter } from './bank-aggregator-registry';

/** What's safe to hand back to a caller — never `encryptedAccessToken`. */
export interface BankAggregatorLinkSummary {
  id: string;
  bankAccountId: string;
  provider: BankAggregatorProvider;
  maskedAccessToken: string;
  status: BankAggregatorLinkStatus;
  lastSyncedAt: Date | null;
}

const SUMMARY_SELECT = {
  id: true,
  bankAccountId: true,
  provider: true,
  maskedAccessToken: true,
  status: true,
  lastSyncedAt: true,
} as const;

/**
 * Per-company lifecycle for a live bank-aggregator connection — see
 * CLAUDE.md "Bank reconciliation — Layer 1b". Every mutating method here
 * ultimately lands its data in the SAME `BankStatementLine` rows Layer
 * 1a's manual CAMT.053 upload produces (via
 * `BankStatementImportService.persistParsedStatement()`), so the
 * matching engine and review UI need zero changes — this service only
 * changes how statement data ARRIVES.
 *
 * `BANK_AGGREGATOR_PORT` is injected as `BankAggregatorPort`'s default
 * (Bridge, since it's the only implementation this pass ships) for
 * convenience, but every method that needs a specific link's own
 * decrypted token constructs its own adapter via
 * `createBankAggregatorAdapter(link.provider, config)` rather than
 * trusting the injected default to match — this stays correct once a
 * second provider exists, mirroring `createCloudModelAdapter()`'s own
 * per-call construction discipline.
 */
@Injectable()
export class BankAggregatorLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: CredentialEncryptionService,
    private readonly config: ConfigService,
    private readonly statementImport: BankStatementImportService,
    @Inject(BANK_AGGREGATOR_PORT) private readonly defaultPort: BankAggregatorPort,
  ) {}

  async createConnectSession(
    company: CompanyContext,
    bankAccountId: string,
  ): Promise<{ connectUrl: string }> {
    await this.assertJurisdictionSupported(company);
    await this.requireBankAccount(company, bankAccountId);
    return this.defaultPort.createConnectSession(company);
  }

  async confirmLink(
    company: CompanyContext,
    bankAccountId: string,
    callbackPayload: Record<string, unknown>,
  ): Promise<BankAggregatorLinkSummary> {
    await this.assertJurisdictionSupported(company);
    await this.requireBankAccount(company, bankAccountId);

    const { externalItemId, accessToken, label } = await this.defaultPort.confirmLink(
      company,
      callbackPayload,
    );
    const encryptedAccessToken = this.encryption.encrypt(accessToken);
    const maskedAccessToken = this.encryption.mask(label || accessToken);

    return this.prisma.bankAggregatorLink.upsert({
      where: { bankAccountId },
      create: {
        companyId: company.companyId,
        bankAccountId,
        provider: BankAggregatorProvider.BRIDGE,
        externalItemId,
        encryptedAccessToken,
        maskedAccessToken,
        status: BankAggregatorLinkStatus.ACTIVE,
      },
      update: {
        provider: BankAggregatorProvider.BRIDGE,
        externalItemId,
        encryptedAccessToken,
        maskedAccessToken,
        status: BankAggregatorLinkStatus.ACTIVE,
      },
      select: SUMMARY_SELECT,
    });
  }

  list(company: CompanyContext): Promise<BankAggregatorLinkSummary[]> {
    return this.prisma.bankAggregatorLink.findMany({
      where: { companyId: company.companyId },
      select: SUMMARY_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * User-triggered only — no scheduler, no webhook subscription, see
   * CLAUDE.md "Bank reconciliation — Layer 1b" for why. Pulls
   * transactions since the link's own `lastSyncedAt` (or the full
   * history on a first sync), then reuses
   * `BankStatementImportService`'s existing duplicate check and
   * persistence path verbatim — same all-or-nothing refusal a manual
   * CAMT.053 re-import already gets.
   */
  async syncNow(
    company: CompanyContext,
    bankAccountId: string,
  ): Promise<{ importedLines: number }> {
    const link = await this.requireActiveLink(company, bankAccountId);
    const port = this.portFor(link.provider);
    const accessToken = this.encryption.decrypt(link.encryptedAccessToken);

    const parsed = await port.fetchTransactions(
      accessToken,
      link.externalItemId,
      link.lastSyncedAt ?? undefined,
    );
    const existingReferences = await this.statementImport.existingReferences(
      company,
      bankAccountId,
    );
    this.statementImport.assertNoDuplicates(parsed, existingReferences);

    const sourceLabel = `Bridge — synchronisation du ${new Date().toISOString().slice(0, 10)}`;
    await this.statementImport.persistParsedStatement(company, bankAccountId, sourceLabel, parsed);
    await this.prisma.bankAggregatorLink.update({
      where: { id: link.id },
      data: { lastSyncedAt: new Date() },
    });
    return { importedLines: parsed.lines.length };
  }

  /**
   * MUST call the provider's own `revoke()` before deleting the local
   * row — see `BankAggregatorPort.revoke()`'s own doc comment for why
   * this ordering is load-bearing, not incidental. If the provider call
   * fails, the row is marked `ERROR` rather than silently kept `ACTIVE`
   * or deleted anyway — a failed revoke is a real state a human needs to
   * see and retry, not something to paper over either direction.
   */
  async revoke(company: CompanyContext, bankAccountId: string): Promise<void> {
    const link = await this.requireLink(company, bankAccountId);
    const port = this.portFor(link.provider);
    const accessToken = this.encryption.decrypt(link.encryptedAccessToken);

    try {
      await port.revoke(accessToken, link.externalItemId);
    } catch (err) {
      await this.prisma.bankAggregatorLink.update({
        where: { id: link.id },
        data: { status: BankAggregatorLinkStatus.ERROR },
      });
      throw err;
    }
    await this.prisma.bankAggregatorLink.delete({ where: { id: link.id } });
  }

  private portFor(provider: BankAggregatorProvider): BankAggregatorPort {
    return createBankAggregatorAdapter(provider, this.config);
  }

  private async assertJurisdictionSupported(company: CompanyContext): Promise<void> {
    const companyRecord = await this.prisma.company.findUnique({
      where: { id: company.companyId },
    });
    if (!companyRecord) {
      throw new NotFoundException(`Company ${company.companyId} not found`);
    }
    if (companyRecord.jurisdiction === 'MC') {
      // Deliberately deferred, not a silent gap — see CLAUDE.md "Bank
      // reconciliation — Layer 1b": neither Bridge's nor Powens' Monaco
      // bank coverage could be confirmed, and Monaco's own legal
      // relationship to PSD2 is itself unsettled in what was found.
      // Manual CAMT.053 upload (Layer 1a) remains fully available to a
      // Monaco-jurisdiction company — only live aggregator connectivity
      // is gated here.
      throw new NotImplementedException(
        "La connexion bancaire en direct n'est pas encore disponible pour les sociétés monégasques " +
          '— la couverture bancaire de Monaco et son rattachement légal à la DSP2 ne sont pas ' +
          "confirmés pour l'instant. L'import manuel de relevé (CAMT.053) reste disponible.",
      );
    }
  }

  private async requireBankAccount(company: CompanyContext, bankAccountId: string): Promise<void> {
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, companyId: company.companyId },
    });
    if (!bankAccount) {
      throw new NotFoundException(`Bank account ${bankAccountId} not found`);
    }
  }

  private async requireLink(
    company: CompanyContext,
    bankAccountId: string,
  ): Promise<BankAggregatorLink> {
    const link = await this.prisma.bankAggregatorLink.findFirst({
      where: { bankAccountId, companyId: company.companyId },
    });
    if (!link) {
      throw new NotFoundException(`No bank-aggregator link for bank account ${bankAccountId}`);
    }
    return link;
  }

  private async requireActiveLink(
    company: CompanyContext,
    bankAccountId: string,
  ): Promise<BankAggregatorLink> {
    const link = await this.requireLink(company, bankAccountId);
    if (link.status !== BankAggregatorLinkStatus.ACTIVE) {
      throw new ConflictException(
        `Ce lien bancaire n'est pas actif (statut : ${link.status}) — reconnectez le compte avant de synchroniser.`,
      );
    }
    return link;
  }
}

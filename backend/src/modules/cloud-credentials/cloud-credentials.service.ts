import { Injectable, NotFoundException } from '@nestjs/common';
import { CloudModelProvider } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CredentialEncryptionService } from '../../common/crypto/credential-encryption.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { SetCloudCredentialDto } from './dto/set-cloud-credential.dto';

/** What's safe to hand back to a caller — never `encryptedApiKey`. */
export interface CloudCredentialSummary {
  provider: CloudModelProvider;
  maskedKey: string;
  updatedAt: Date;
}

const SUMMARY_SELECT = { provider: true, maskedKey: true, updatedAt: true } as const;

/**
 * Company-scoped storage for a BYO cloud-provider API key — see
 * CloudModelCredential's own doc comment in schema.prisma and CLAUDE.md
 * "AI chatbot cloud tier". The plaintext key exists in memory only for the
 * duration of one `set()` or `getDecryptedKey()` call; every other method,
 * and every value this service returns to a controller, deals only in
 * `CloudCredentialSummary` (a masked hint, never the real key).
 *
 * `getDecryptedKey()` is the one method that returns the real plaintext —
 * deliberately not exposed by CloudCredentialsController at all. It exists
 * for the cloud model adapters (Claude/DeepSeek — see the implementation
 * spec) to call directly when they actually need to authenticate to a
 * provider, never for display.
 */
@Injectable()
export class CloudCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: CredentialEncryptionService,
  ) {}

  /**
   * Upserts (setting a new key for a provider replaces the existing one —
   * see the schema's own `@@unique([companyId, provider])`). Encrypts
   * before it ever reaches Prisma; the plaintext `dto.apiKey` is never
   * logged and never persisted anywhere in the clear.
   */
  async set(company: CompanyContext, dto: SetCloudCredentialDto): Promise<CloudCredentialSummary> {
    const encryptedApiKey = this.encryption.encrypt(dto.apiKey);
    const maskedKey = this.encryption.mask(dto.apiKey);
    return this.prisma.cloudModelCredential.upsert({
      where: { companyId_provider: { companyId: company.companyId, provider: dto.provider } },
      create: { companyId: company.companyId, provider: dto.provider, encryptedApiKey, maskedKey },
      update: { encryptedApiKey, maskedKey },
      select: SUMMARY_SELECT,
    });
  }

  list(company: CompanyContext): Promise<CloudCredentialSummary[]> {
    return this.prisma.cloudModelCredential.findMany({
      where: { companyId: company.companyId },
      select: SUMMARY_SELECT,
      orderBy: { provider: 'asc' },
    });
  }

  async revoke(company: CompanyContext, provider: CloudModelProvider): Promise<void> {
    const existing = await this.prisma.cloudModelCredential.findUnique({
      where: { companyId_provider: { companyId: company.companyId, provider } },
    });
    if (!existing) {
      throw new NotFoundException(`No ${provider} credential is configured for this company.`);
    }
    await this.prisma.cloudModelCredential.delete({ where: { id: existing.id } });
  }

  /**
   * The real plaintext key, decrypted on demand — never cached, never
   * returned by any controller. Throws (rather than silently degrading to
   * "no cloud available") when no credential exists, since a caller that
   * reaches this method has already committed to the cloud path (see the
   * server-side granularity enforcement in CLAUDE.md "AI chatbot cloud
   * tier") and a missing key at this point is a real configuration error,
   * not a normal "not opted in" state — that state is checked earlier,
   * before the cloud action is even offered.
   */
  async getDecryptedKey(company: CompanyContext, provider: CloudModelProvider): Promise<string> {
    const existing = await this.prisma.cloudModelCredential.findUnique({
      where: { companyId_provider: { companyId: company.companyId, provider } },
    });
    if (!existing) {
      throw new NotFoundException(`No ${provider} credential is configured for this company.`);
    }
    return this.encryption.decrypt(existing.encryptedApiKey);
  }
}

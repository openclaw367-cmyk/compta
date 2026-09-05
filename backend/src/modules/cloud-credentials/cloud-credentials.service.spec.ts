import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudModelProvider } from '@prisma/client';
import { CloudCredentialsService } from './cloud-credentials.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CredentialEncryptionService } from '../../common/crypto/credential-encryption.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1', role: 'OWNER' };
const ENCRYPTION_KEY = '0'.repeat(64);

function makePrismaMock() {
  const store = new Map<
    string,
    {
      id: string;
      companyId: string;
      provider: CloudModelProvider;
      encryptedApiKey: string;
      maskedKey: string;
    }
  >();
  let nextId = 1;
  const keyFor = (companyId: string, provider: CloudModelProvider) => `${companyId}:${provider}`;

  return {
    store,
    cloudModelCredential: {
      upsert: jest.fn(
        (args: {
          where: { companyId_provider: { companyId: string; provider: CloudModelProvider } };
          create: {
            companyId: string;
            provider: CloudModelProvider;
            encryptedApiKey: string;
            maskedKey: string;
          };
          update: { encryptedApiKey: string; maskedKey: string };
          select: unknown;
        }) => {
          const key = keyFor(
            args.where.companyId_provider.companyId,
            args.where.companyId_provider.provider,
          );
          const existing = store.get(key);
          const row = existing
            ? { ...existing, ...args.update }
            : { id: `cred-${nextId++}`, ...args.create };
          store.set(key, row);
          return { provider: row.provider, maskedKey: row.maskedKey, updatedAt: new Date() };
        },
      ),
      findMany: jest.fn((args: { where: { companyId: string } }) =>
        [...store.values()]
          .filter((row) => row.companyId === args.where.companyId)
          .map((row) => ({
            provider: row.provider,
            maskedKey: row.maskedKey,
            updatedAt: new Date(),
          })),
      ),
      findUnique: jest.fn(
        (args: {
          where: { companyId_provider: { companyId: string; provider: CloudModelProvider } };
        }) =>
          store.get(
            keyFor(args.where.companyId_provider.companyId, args.where.companyId_provider.provider),
          ) ?? null,
      ),
      delete: jest.fn((args: { where: { id: string } }) => {
        const entry = [...store.entries()].find(([, row]) => row.id === args.where.id);
        if (entry) {
          store.delete(entry[0]);
        }
      }),
    },
  };
}

function buildService() {
  const prisma = makePrismaMock();
  const config = {
    get: jest.fn((key: string) =>
      key === 'CLOUD_CREDENTIAL_ENCRYPTION_KEY' ? ENCRYPTION_KEY : undefined,
    ),
  } as unknown as ConfigService;
  const encryption = new CredentialEncryptionService(config);
  const service = new CloudCredentialsService(prisma as unknown as PrismaService, encryption);
  return { service, prisma, encryption };
}

describe('CloudCredentialsService', () => {
  it('set() encrypts the key and returns only a masked summary, never the real key', async () => {
    const { service, prisma } = buildService();
    const summary = await service.set(company, {
      provider: CloudModelProvider.CLAUDE,
      apiKey: 'sk-ant-api03-realsecretvaluehere1234',
    });

    expect(summary).toEqual({
      provider: CloudModelProvider.CLAUDE,
      maskedKey: 'sk-...1234',
      updatedAt: expect.any(Date),
    });
    const stored = [...prisma.store.values()][0];
    expect(stored.encryptedApiKey).not.toContain('realsecretvaluehere');
    expect(JSON.stringify(summary)).not.toContain('realsecretvaluehere');
  });

  it('set() replaces (upserts) an existing credential for the same provider rather than duplicating it', async () => {
    const { service, prisma } = buildService();
    await service.set(company, {
      provider: CloudModelProvider.CLAUDE,
      apiKey: 'sk-ant-first-key-000000',
    });
    await service.set(company, {
      provider: CloudModelProvider.CLAUDE,
      apiKey: 'sk-ant-second-key-111111',
    });

    expect(prisma.store.size).toBe(1);
    const decrypted = await service.getDecryptedKey(company, CloudModelProvider.CLAUDE);
    expect(decrypted).toBe('sk-ant-second-key-111111');
  });

  it('list() returns masked summaries for every configured provider, scoped to the company', async () => {
    const { service } = buildService();
    await service.set(company, {
      provider: CloudModelProvider.CLAUDE,
      apiKey: 'sk-ant-key-00000000',
    });
    await service.set(company, {
      provider: CloudModelProvider.DEEPSEEK,
      apiKey: 'sk-deepseek-key-0000',
    });
    await service.set(
      { companyId: 'other-company', role: 'OWNER' },
      {
        provider: CloudModelProvider.CLAUDE,
        apiKey: 'sk-ant-belongs-to-someone-else',
      },
    );

    const result = await service.list(company);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.provider).sort()).toEqual([
      CloudModelProvider.CLAUDE,
      CloudModelProvider.DEEPSEEK,
    ]);
    expect(JSON.stringify(result)).not.toContain('someone-else');
  });

  it('revoke() deletes the credential', async () => {
    const { service, prisma } = buildService();
    await service.set(company, {
      provider: CloudModelProvider.CLAUDE,
      apiKey: 'sk-ant-key-00000000',
    });
    await service.revoke(company, CloudModelProvider.CLAUDE);
    expect(prisma.store.size).toBe(0);
  });

  it('revoke() throws NotFoundException, naming the provider, when nothing is configured', async () => {
    const { service } = buildService();
    await expect(service.revoke(company, CloudModelProvider.DEEPSEEK)).rejects.toThrow(
      /No DEEPSEEK credential is configured/,
    );
    await expect(service.revoke(company, CloudModelProvider.DEEPSEEK)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('getDecryptedKey() throws NotFoundException when nothing is configured for that provider', async () => {
    const { service } = buildService();
    await expect(service.getDecryptedKey(company, CloudModelProvider.CLAUDE)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('getDecryptedKey() returns the real plaintext key for the one caller allowed to see it', async () => {
    const { service } = buildService();
    await service.set(company, {
      provider: CloudModelProvider.DEEPSEEK,
      apiKey: 'sk-deepseek-real-key-xyz',
    });
    await expect(service.getDecryptedKey(company, CloudModelProvider.DEEPSEEK)).resolves.toBe(
      'sk-deepseek-real-key-xyz',
    );
  });

  it('credentials for two providers on the same company are independent', async () => {
    const { service } = buildService();
    await service.set(company, {
      provider: CloudModelProvider.CLAUDE,
      apiKey: 'sk-ant-claude-only-key',
    });
    await service.set(company, {
      provider: CloudModelProvider.DEEPSEEK,
      apiKey: 'sk-deepseek-only-key',
    });
    await service.revoke(company, CloudModelProvider.CLAUDE);

    await expect(service.getDecryptedKey(company, CloudModelProvider.CLAUDE)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.getDecryptedKey(company, CloudModelProvider.DEEPSEEK)).resolves.toBe(
      'sk-deepseek-only-key',
    );
  });
});

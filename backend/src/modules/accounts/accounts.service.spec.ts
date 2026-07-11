import { BadRequestException } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

describe('AccountsService', () => {
  const company: CompanyContext = { companyId: 'company-1' };
  let prisma: { account: { create: jest.Mock } };
  let service: AccountsService;

  beforeEach(() => {
    prisma = {
      account: {
        create: jest.fn((args: { data: object }) => ({ id: 'acc-1', ...args.data })),
      },
    };
    service = new AccountsService(prisma as unknown as PrismaService);
  });

  it('derives the PCG class from the leading digit of the account number', async () => {
    const account = await service.create(company, { number: '411000', label: 'Clients' });
    expect(account).toMatchObject({ pcgClass: 4, number: '411000' });
  });

  it('scopes the created account to the current company', async () => {
    await service.create(company, { number: '607000', label: 'Achats de marchandises' });
    expect(prisma.account.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ companyId: 'company-1' }) }),
    );
  });

  it('rejects an account number outside the PCG class range 1-8', async () => {
    await expect(service.create(company, { number: '9000', label: 'Bogus' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a non-numeric leading character', async () => {
    await expect(service.create(company, { number: 'X000', label: 'Bogus' })).rejects.toThrow(
      BadRequestException,
    );
  });
});

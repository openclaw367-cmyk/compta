import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FecExportService } from './fec-export.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { FEC_COLUMNS } from './fec-format';

const company: CompanyContext = { companyId: 'company-1' };

function makePrismaMock() {
  return {
    company: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'company-1',
        jurisdiction: 'FR',
        siren: '123456789',
        rci: null,
      }),
    },
    fiscalYear: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'fy-2026',
        endDate: new Date(Date.UTC(2026, 11, 31)),
      }),
    },
    ecriture: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'ecriture-1',
          ecritureNum: 1,
          ecritureDate: new Date(Date.UTC(2026, 0, 15)),
          pieceRef: 'FA-2026-001',
          pieceDate: new Date(Date.UTC(2026, 0, 14)),
          libelle: 'Achat fournitures',
          validatedAt: new Date(Date.UTC(2026, 0, 31)),
          journal: { code: 'AC', label: 'Achats' },
          lignes: [
            {
              compte: { number: '607000', label: 'Achats de marchandises' },
              compteAux: null,
              debit: new Prisma.Decimal('100.00'),
              credit: new Prisma.Decimal('0.00'),
              lettrage: null,
              dateLettrage: null,
              montantDevise: null,
              idDevise: null,
            },
            {
              compte: { number: '401000', label: 'Fournisseurs' },
              compteAux: null,
              debit: new Prisma.Decimal('0.00'),
              credit: new Prisma.Decimal('100.00'),
              lettrage: null,
              dateLettrage: null,
              montantDevise: null,
              idDevise: null,
            },
          ],
        },
      ]),
    },
  };
}

describe('FecExportService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: FecExportService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new FecExportService(prisma as unknown as PrismaService);
  });

  it('produces the exact 18-column pipe-delimited header', async () => {
    const { content } = await service.generate(company, 'fy-2026');
    const headerLine = content.split('\r\n')[0];
    expect(headerLine).toBe(FEC_COLUMNS.join('|'));
    expect(headerLine.split('|')).toHaveLength(18);
  });

  it('formats dates as AAAAMMJJ and amounts with a 2-decimal point', async () => {
    const { content } = await service.generate(company, 'fy-2026');
    const dataLine = content.split('\r\n')[1];
    const fields = dataLine.split('|');

    expect(fields[0]).toBe('AC'); // JournalCode
    expect(fields[2]).toBe('1'); // EcritureNum
    expect(fields[3]).toBe('20260115'); // EcritureDate
    expect(fields[4]).toBe('607000'); // CompteNum
    expect(fields[11]).toBe('100.00'); // Debit
    expect(fields[12]).toBe('0.00'); // Credit
    expect(fields[15]).toBe('20260131'); // ValidDate
  });

  it('names the file {SIREN}FEC{closingDate}.txt', async () => {
    const { fileName } = await service.generate(company, 'fy-2026');
    expect(fileName).toBe('123456789FEC20261231.txt');
  });

  it('refuses to export when the company has no SIREN', async () => {
    prisma.company.findUnique.mockResolvedValueOnce({
      id: 'company-1',
      jurisdiction: 'FR',
      siren: null,
      rci: null,
    });
    await expect(service.generate(company, 'fy-2026')).rejects.toThrow(BadRequestException);
  });

  it('refuses to export a fiscal year that still has unvalidated (draft) écritures', async () => {
    prisma.ecriture.count.mockResolvedValueOnce(2);
    await expect(service.generate(company, 'fy-2026')).rejects.toThrow(ConflictException);
  });
});

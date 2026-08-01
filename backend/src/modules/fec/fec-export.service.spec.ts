import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FecExportService } from './fec-export.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { FEC_COLUMNS } from './fec-format';

const company: CompanyContext = { companyId: 'company-1' };

function makeEcriture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ecriture-1',
    ecritureNum: '1',
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
    ...overrides,
  };
}

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
      findMany: jest.fn().mockResolvedValue([makeEcriture()]),
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

  it('formats dates as AAAAMMJJ, EcritureNum as a string, and amounts with a decimal comma', async () => {
    const { content } = await service.generate(company, 'fy-2026');
    const dataLine = content.split('\r\n')[1];
    const fields = dataLine.split('|');

    expect(fields[0]).toBe('AC'); // JournalCode
    expect(fields[2]).toBe('1'); // EcritureNum
    expect(fields[3]).toBe('20260115'); // EcritureDate
    expect(fields[4]).toBe('607000'); // CompteNum
    expect(fields[11]).toBe('100,00'); // Debit — comma, not point (Art. A47 A-1 §XII)
    expect(fields[12]).toBe('0,00'); // Credit
    expect(fields[15]).toBe('20260131'); // ValidDate
    // Never a point in a monetary field.
    expect(fields[11]).not.toContain('.');
    expect(fields[12]).not.toContain('.');
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

  describe('PieceRef/PieceDate — never blank (Art. A47 A-1 §180/§190)', () => {
    it('uses the real PieceRef/PieceDate when the écriture has them', async () => {
      const { content } = await service.generate(company, 'fy-2026');
      const fields = content.split('\r\n')[1].split('|');
      expect(fields[8]).toBe('FA-2026-001'); // PieceRef
      expect(fields[9]).toBe('20260114'); // PieceDate
    });

    it('falls back to "NA" for PieceRef when the écriture has none (e.g. écritures d\'à nouveau)', async () => {
      prisma.ecriture.findMany.mockResolvedValueOnce([makeEcriture({ pieceRef: null })]);
      const { content } = await service.generate(company, 'fy-2026');
      const fields = content.split('\r\n')[1].split('|');
      expect(fields[8]).toBe('NA');
      // Never blank.
      expect(fields[8]).not.toBe('');
    });

    it("falls back to the écriture's own EcritureDate for PieceDate when none is set", async () => {
      prisma.ecriture.findMany.mockResolvedValueOnce([makeEcriture({ pieceDate: null })]);
      const { content } = await service.generate(company, 'fy-2026');
      const fields = content.split('\r\n')[1].split('|');
      expect(fields[9]).toBe('20260115'); // same as EcritureDate
      expect(fields[9]).not.toBe('');
    });
  });

  describe('auxiliary accounts (tiers)', () => {
    it(
      'puts the collectif in CompteNum/CompteLib (fields 5/6) and the tiers in ' +
        'CompAuxNum/CompAuxLib (fields 7/8) — never the tiers as the posting account',
      async () => {
        prisma.ecriture.findMany.mockResolvedValueOnce([
          makeEcriture({
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
                // compteId points at the 401000 collectif; compteAuxId points at
                // the tiers created under it — see AccountsService.createTiers.
                compte: { number: '401000', label: 'Fournisseurs' },
                compteAux: { number: '401001', label: 'Fournisseur Dupont' },
                debit: new Prisma.Decimal('0.00'),
                credit: new Prisma.Decimal('100.00'),
                lettrage: null,
                dateLettrage: null,
                montantDevise: null,
                idDevise: null,
              },
            ],
          }),
        ]);

        const { content } = await service.generate(company, 'fy-2026');
        const fields = content.split('\r\n')[2].split('|');

        expect(fields[4]).toBe('401000'); // CompteNum (field 5) — the collectif
        expect(fields[5]).toBe('Fournisseurs'); // CompteLib (field 6)
        expect(fields[6]).toBe('401001'); // CompAuxNum (field 7) — the tiers
        expect(fields[7]).toBe('Fournisseur Dupont'); // CompAuxLib (field 8)
      },
    );

    it('leaves CompAuxNum/CompAuxLib blank for an ordinary line with no tiers', async () => {
      const { content } = await service.generate(company, 'fy-2026');
      const fields = content.split('\r\n')[1].split('|');
      expect(fields[6]).toBe('');
      expect(fields[7]).toBe('');
    });
  });

  describe('generateDescription', () => {
    it('documents the delimiter, decimal comma, and PieceRef/PieceDate conventions', async () => {
      const { fileName, content } = await service.generateDescription(company, 'fy-2026');
      expect(fileName).toBe('123456789FEC20261231_description.txt');
      expect(content).toContain('"|"');
      expect(content).toContain('virgule');
      expect(content).toContain('AAAAMMJJ');
      expect(content).toContain('"NA"');
    });

    it('refuses when the company has no SIREN, same as the main export', async () => {
      prisma.company.findUnique.mockResolvedValueOnce({
        id: 'company-1',
        jurisdiction: 'FR',
        siren: null,
        rci: null,
      });
      await expect(service.generateDescription(company, 'fy-2026')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});

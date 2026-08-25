import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BankReconciliationService } from './bank-reconciliation.service';
import { EntriesService } from '../entries/entries.service';
import { CreateEcritureDto } from '../entries/dto/create-ecriture.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };

// This test only exercises BankReconciliationService's own auto-confirm
// logic around whatever EntriesService.create() (mocked below) returns —
// the DTO's own content is irrelevant here, so a minimal stand-in beats
// a full realistic payload.
const stubCreateDto: CreateEcritureDto = {
  journalId: 'journal-1',
  fiscalYearId: 'fiscal-year-1',
  ecritureDate: '2026-03-05',
  libelle: 'Test',
  lignes: [],
};

function makePrismaMock() {
  return {
    bankAccount: { findFirst: jest.fn() },
    bankStatementLine: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn((args: { where: { id: string }; data: unknown }) => ({
        id: args.where.id,
        ...(args.data as object),
      })),
    },
    ecritureLigne: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
  };
}

function makeEntriesServiceMock() {
  return {
    setLettrage: jest.fn().mockResolvedValue({ id: 'ligne-x', lettrage: 'R1' }),
    create: jest.fn(),
  };
}

describe('BankReconciliationService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let entries: ReturnType<typeof makeEntriesServiceMock>;
  let service: BankReconciliationService;

  beforeEach(() => {
    prisma = makePrismaMock();
    entries = makeEntriesServiceMock();
    service = new BankReconciliationService(
      prisma as unknown as PrismaService,
      entries as unknown as EntriesService,
    );
  });

  describe('listStatementLines', () => {
    it('rejects a bank account that does not belong to this company', async () => {
      prisma.bankAccount.findFirst.mockResolvedValueOnce(null);
      await expect(service.listStatementLines(company, 'bank-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lists every line for the account, any status', async () => {
      prisma.bankAccount.findFirst.mockResolvedValueOnce({ id: 'bank-1', compteId: 'acc-512' });
      prisma.bankStatementLine.findMany.mockResolvedValueOnce([
        { id: 'l1', status: 'UNMATCHED' },
        { id: 'l2', status: 'CONFIRMED' },
      ]);
      const result = await service.listStatementLines(company, 'bank-1');
      expect(result).toHaveLength(2);
    });

    it('self-heals a CONFIRMED line whose matchedLigneId went null (e.g. the matched draft was deleted) back to UNMATCHED before returning', async () => {
      prisma.bankAccount.findFirst.mockResolvedValueOnce({ id: 'bank-1', compteId: 'acc-512' });
      await service.listStatementLines(company, 'bank-1');
      expect(prisma.bankStatementLine.updateMany).toHaveBeenCalledWith({
        where: {
          companyId: 'company-1',
          bankAccountId: 'bank-1',
          status: 'CONFIRMED',
          matchedLigneId: null,
        },
        data: { status: 'UNMATCHED' },
      });
    });
  });

  describe('getProposals', () => {
    it('rejects a bank account that does not belong to this company', async () => {
      prisma.bankAccount.findFirst.mockResolvedValueOnce(null);
      await expect(service.getProposals(company, 'bank-x')).rejects.toThrow(NotFoundException);
    });

    it('returns [] with no queries against ecritureLigne when there are no unmatched statement lines', async () => {
      prisma.bankAccount.findFirst.mockResolvedValueOnce({ id: 'bank-1', compteId: 'acc-512' });
      prisma.bankStatementLine.findMany.mockResolvedValueOnce([]);
      const result = await service.getProposals(company, 'bank-1');
      expect(result).toEqual([]);
      expect(prisma.ecritureLigne.findMany).not.toHaveBeenCalled();
    });

    it('runs the matching engine against the fetched unlettered candidates and returns real proposals', async () => {
      prisma.bankAccount.findFirst.mockResolvedValueOnce({ id: 'bank-1', compteId: 'acc-512' });
      prisma.bankStatementLine.findMany.mockResolvedValueOnce([
        { id: 'stmt-1', bookingDate: new Date('2026-03-05'), amount: '100.00', label: 'PRLV X' },
      ]);
      prisma.ecritureLigne.findMany.mockResolvedValueOnce([
        {
          id: 'ligne-1',
          debit: { toString: () => '100.00' },
          credit: { toString: () => '0.00' },
          ecriture: {
            id: 'e1',
            ecritureNum: '5',
            ecritureDate: new Date('2026-03-05'),
            libelle: 'X',
          },
        },
      ]);
      const result = await service.getProposals(company, 'bank-1');
      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBe('HIGH');
      expect(result[0].candidates[0].ecritureLigneId).toBe('ligne-1');
    });
  });

  describe('confirmMatch', () => {
    it('sets lettrage on the chosen ligne and marks the statement line CONFIRMED', async () => {
      prisma.bankStatementLine.findFirst.mockResolvedValueOnce({
        id: 'stmt-1',
        status: 'UNMATCHED',
        bankAccount: { compteId: 'acc-512' },
      });
      prisma.ecritureLigne.findFirst.mockResolvedValueOnce({ id: 'ligne-1', lettrage: null });
      prisma.ecritureLigne.findMany.mockResolvedValueOnce([]); // nextLettrageCode's own scan

      await service.confirmMatch(company, 'stmt-1', 'ligne-1');

      expect(entries.setLettrage).toHaveBeenCalledWith(company, 'ligne-1', 'R1');
      expect(prisma.bankStatementLine.update).toHaveBeenCalledWith({
        where: { id: 'stmt-1' },
        data: { status: 'CONFIRMED', matchedLigneId: 'ligne-1' },
      });
    });

    it('rejects confirming against a ligne that is already lettrée', async () => {
      prisma.bankStatementLine.findFirst.mockResolvedValueOnce({
        id: 'stmt-1',
        status: 'UNMATCHED',
        bankAccount: { compteId: 'acc-512' },
      });
      prisma.ecritureLigne.findFirst.mockResolvedValueOnce({ id: 'ligne-1', lettrage: 'A1' });
      await expect(service.confirmMatch(company, 'stmt-1', 'ligne-1')).rejects.toThrow(
        ConflictException,
      );
      expect(entries.setLettrage).not.toHaveBeenCalled();
    });

    it('rejects a statement line that is not UNMATCHED', async () => {
      prisma.bankStatementLine.findFirst.mockResolvedValueOnce({
        id: 'stmt-1',
        status: 'CONFIRMED',
      });
      await expect(service.confirmMatch(company, 'stmt-1', 'ligne-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('generates sequential R{n} codes, never colliding with an existing max', async () => {
      prisma.bankStatementLine.findFirst.mockResolvedValueOnce({
        id: 'stmt-1',
        status: 'UNMATCHED',
        bankAccount: { compteId: 'acc-512' },
      });
      prisma.ecritureLigne.findFirst.mockResolvedValueOnce({ id: 'ligne-1', lettrage: null });
      prisma.ecritureLigne.findMany.mockResolvedValueOnce([
        { lettrage: 'R3' },
        { lettrage: 'R1' },
        { lettrage: 'A1' }, // a manual code — must not be confused with the R-namespace
      ]);
      await service.confirmMatch(company, 'stmt-1', 'ligne-1');
      expect(entries.setLettrage).toHaveBeenCalledWith(company, 'ligne-1', 'R4');
    });
  });

  describe('clearMatch', () => {
    it('clears lettrage on the matched ligne and reverts the statement line to UNMATCHED', async () => {
      prisma.bankStatementLine.findFirst.mockResolvedValueOnce({
        id: 'stmt-1',
        status: 'CONFIRMED',
        matchedLigneId: 'ligne-1',
      });
      await service.clearMatch(company, 'stmt-1');
      expect(entries.setLettrage).toHaveBeenCalledWith(company, 'ligne-1', null);
      expect(prisma.bankStatementLine.update).toHaveBeenCalledWith({
        where: { id: 'stmt-1' },
        data: { status: 'UNMATCHED', matchedLigneId: null },
      });
    });

    it('rejects clearing a line that is not currently CONFIRMED', async () => {
      prisma.bankStatementLine.findFirst.mockResolvedValueOnce({
        id: 'stmt-1',
        status: 'UNMATCHED',
      });
      await expect(service.clearMatch(company, 'stmt-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('ignore', () => {
    it('marks the line IGNORED with the given reason', async () => {
      prisma.bankStatementLine.findFirst.mockResolvedValueOnce({
        id: 'stmt-1',
        status: 'UNMATCHED',
        bankAccount: { compteId: 'acc-512' },
      });
      await service.ignore(company, 'stmt-1', 'Virement interne');
      expect(prisma.bankStatementLine.update).toHaveBeenCalledWith({
        where: { id: 'stmt-1' },
        data: { status: 'IGNORED', ignoredReason: 'Virement interne' },
      });
    });
  });

  describe('createEcritureFromLine', () => {
    it('creates via EntriesService.create() then confirms the match on the one bank-account line', async () => {
      prisma.bankStatementLine.findFirst.mockResolvedValueOnce({
        id: 'stmt-1',
        status: 'UNMATCHED',
        bankAccount: { compteId: 'acc-512' },
      });
      entries.create.mockResolvedValueOnce({
        id: 'ecriture-1',
        warnings: [],
        lignes: [
          { id: 'ligne-bank', compteId: 'acc-512' },
          { id: 'ligne-other', compteId: 'acc-606' },
        ],
      });
      prisma.ecritureLigne.findMany.mockResolvedValueOnce([]); // nextLettrageCode

      await service.createEcritureFromLine(company, 'stmt-1', stubCreateDto);

      expect(entries.setLettrage).toHaveBeenCalledWith(company, 'ligne-bank', 'R1');
      expect(prisma.bankStatementLine.update).toHaveBeenCalledWith({
        where: { id: 'stmt-1' },
        data: { status: 'CONFIRMED', matchedLigneId: 'ligne-bank' },
      });
    });

    it('refuses (naming the count) when the created écriture does not touch the bank account exactly once', async () => {
      prisma.bankStatementLine.findFirst.mockResolvedValueOnce({
        id: 'stmt-1',
        status: 'UNMATCHED',
        bankAccount: { compteId: 'acc-512' },
      });
      entries.create.mockResolvedValueOnce({
        id: 'ecriture-1',
        warnings: [],
        lignes: [{ id: 'ligne-other', compteId: 'acc-606' }],
      });
      await expect(
        service.createEcritureFromLine(company, 'stmt-1', stubCreateDto),
      ).rejects.toThrow(BadRequestException);
      expect(entries.setLettrage).not.toHaveBeenCalled();
    });
  });
});

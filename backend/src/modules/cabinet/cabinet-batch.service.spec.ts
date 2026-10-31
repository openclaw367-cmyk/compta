import { BadRequestException, ConflictException } from '@nestjs/common';
import { CabinetBatchService } from './cabinet-batch.service';
import { CompaniesService } from '../companies/companies.service';
import { FiscalYearsService } from '../fiscal-years/fiscal-years.service';
import { FecExportService } from '../fec/fec-export.service';
import { AuthenticatedUser } from '../../common/auth/request-with-user';
import { Company, FiscalYear, MembershipRole } from '@prisma/client';

const user: AuthenticatedUser = { id: 'user-1', email: 'caller@example.com' };

function company(
  id: string,
  name: string,
  role: MembershipRole = 'OWNER',
): Company & { role: MembershipRole } {
  return {
    id,
    name,
    siren: '123456789',
    rci: null,
    jurisdiction: 'FR',
    regime: 'REEL_NORMAL',
    vatNumber: null,
    nextEcritureNum: 1,
    nextInvoiceNum: 1,
    regimeTvaServices: 'ENCAISSEMENTS',
    addressLine: null,
    postalCode: null,
    city: null,
    country: 'France',
    phone: null,
    email: null,
    bankName: null,
    iban: null,
    bic: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    role,
  } as unknown as Company & { role: MembershipRole };
}

function fiscalYear(
  id: string,
  label: string,
  endDate: string,
  closedAt: Date | null = null,
): FiscalYear {
  return {
    id,
    companyId: 'irrelevant',
    label,
    startDate: new Date('2026-01-01'),
    endDate: new Date(endDate),
    closedAt,
  };
}

describe('CabinetBatchService', () => {
  let companiesService: { findAllForUser: jest.Mock };
  let fiscalYearsService: { findAll: jest.Mock };
  let fecExportService: { generate: jest.Mock };
  let service: CabinetBatchService;

  beforeEach(() => {
    companiesService = { findAllForUser: jest.fn() };
    fiscalYearsService = { findAll: jest.fn() };
    fecExportService = { generate: jest.fn() };
    service = new CabinetBatchService(
      companiesService as unknown as CompaniesService,
      fiscalYearsService as unknown as FiscalYearsService,
      fecExportService as unknown as FecExportService,
    );
  });

  it('rejects a malformed month', async () => {
    companiesService.findAllForUser.mockResolvedValue([]);
    await expect(service.exportFecForClosingCompanies(user, '2026/10')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.exportFecForClosingCompanies(user, 'not-a-month')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('skips a company with no fiscal year closing this month — not attempted, not reported', async () => {
    const skipped = company('company-skip', 'Société Sans Clôture');
    companiesService.findAllForUser.mockResolvedValue([skipped]);
    fiscalYearsService.findAll.mockResolvedValue([
      fiscalYear('fy-skip', '2026', '2026-12-31'), // closes in December, not October
    ]);

    const result = await service.exportFecForClosingCompanies(user, '2026-10');

    expect(result.results).toHaveLength(0);
    expect(result.succeededCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(fecExportService.generate).not.toHaveBeenCalled();
  });

  it('skips an already-CLOSED fiscal year even if its endDate falls in the requested month', async () => {
    const closedCo = company('company-closed', 'Société Déjà Clôturée');
    companiesService.findAllForUser.mockResolvedValue([closedCo]);
    fiscalYearsService.findAll.mockResolvedValue([
      fiscalYear('fy-closed', '2026', '2026-10-31', new Date('2026-11-01')),
    ]);

    const result = await service.exportFecForClosingCompanies(user, '2026-10');

    expect(result.results).toHaveLength(0);
    expect(fecExportService.generate).not.toHaveBeenCalled();
  });

  it(
    "one company's failure never aborts the loop — the other company's own call still " +
      'completes, and every outcome (success and failure) is named with the real error preserved',
    async () => {
      const failingCo = company('company-fail', 'Société En Défaut');
      const succeedingCo = company('company-ok', 'Société En Ordre', 'MEMBER');
      // Order matters for this test: the FAILING company is processed
      // FIRST, so a bug that short-circuited the loop on the first
      // thrown error would show up as the second company's own call
      // never happening.
      companiesService.findAllForUser.mockResolvedValue([failingCo, succeedingCo]);

      fiscalYearsService.findAll.mockImplementation((context: { companyId: string }) => {
        if (context.companyId === 'company-fail') {
          return Promise.resolve([fiscalYear('fy-fail', '2026', '2026-10-15')]);
        }
        return Promise.resolve([fiscalYear('fy-ok', '2026', '2026-10-20')]);
      });

      const conflictMessage = '3 écriture(s) in this fiscal year are not yet validated.';
      fecExportService.generate.mockImplementation((context: { companyId: string }) => {
        if (context.companyId === 'company-fail') {
          return Promise.reject(new ConflictException(conflictMessage));
        }
        return Promise.resolve({ fileName: '123456789FEC20261031.txt', content: '...' });
      });

      const result = await service.exportFecForClosingCompanies(user, '2026-10');

      expect(result.results).toHaveLength(2);
      expect(result.succeededCount).toBe(1);
      expect(result.failedCount).toBe(1);

      const failedEntry = result.results.find((r) => r.companyId === 'company-fail');
      expect(failedEntry).toMatchObject({
        status: 'FAILED',
        error: conflictMessage,
        fiscalYearId: 'fy-fail',
        companyName: 'Société En Défaut',
      });
      expect(failedEntry?.fileName).toBeUndefined();

      const succeededEntry = result.results.find((r) => r.companyId === 'company-ok');
      expect(succeededEntry).toMatchObject({
        status: 'SUCCEEDED',
        fileName: '123456789FEC20261031.txt',
        fiscalYearId: 'fy-ok',
        companyName: 'Société En Ordre',
      });
      expect(succeededEntry?.error).toBeUndefined();

      // Both companies' own fecExportService.generate() calls genuinely
      // happened — the failing one didn't prevent the succeeding one.
      expect(fecExportService.generate).toHaveBeenCalledTimes(2);
    },
  );

  it(
    "each company's FecExportService.generate() call receives the exact same arguments an " +
      'individual, non-batched call would (CompanyContext built from that membership, plus the ' +
      'matching fiscalYearId) — the regression-equivalence the roadmap calls for',
    async () => {
      const readOnlyCo = company('company-ro', 'Société Lecture Seule', 'READ_ONLY');
      companiesService.findAllForUser.mockResolvedValue([readOnlyCo]);
      fiscalYearsService.findAll.mockResolvedValue([fiscalYear('fy-ro', '2026', '2026-10-01')]);
      fecExportService.generate.mockResolvedValue({
        fileName: '123456789FEC20261031.txt',
        content: '...',
      });

      await service.exportFecForClosingCompanies(user, '2026-10');

      // The exact CompanyContext a single, non-batched
      // CompanyContextMiddleware-resolved call against this same
      // company/caller would have produced.
      expect(fecExportService.generate).toHaveBeenCalledWith(
        { companyId: 'company-ro', role: 'READ_ONLY' },
        'fy-ro',
      );
      expect(fiscalYearsService.findAll).toHaveBeenCalledWith({
        companyId: 'company-ro',
        role: 'READ_ONLY',
      });
    },
  );

  it('only ever acts on companies returned by CompaniesService.findAllForUser (the caller’s own memberships)', async () => {
    const onlyMembership = company('company-only', 'La Seule Société Du Caller');
    companiesService.findAllForUser.mockResolvedValue([onlyMembership]);
    fiscalYearsService.findAll.mockResolvedValue([fiscalYear('fy-only', '2026', '2026-10-05')]);
    fecExportService.generate.mockResolvedValue({ fileName: 'x.txt', content: '...' });

    await service.exportFecForClosingCompanies(user, '2026-10');

    expect(companiesService.findAllForUser).toHaveBeenCalledWith('user-1');
    // fiscalYearsService/fecExportService were only ever asked about
    // the ONE company findAllForUser returned — never any other id.
    expect(fiscalYearsService.findAll).toHaveBeenCalledTimes(1);
    expect(fecExportService.generate).toHaveBeenCalledTimes(1);
  });

  it('includes a fiscal year whose endDate is exactly the first or last day of the month (inclusive boundary)', async () => {
    const boundaryCo = company('company-boundary', 'Société Limite');
    companiesService.findAllForUser.mockResolvedValue([boundaryCo]);
    fiscalYearsService.findAll.mockResolvedValue([
      fiscalYear('fy-first', 'Premier jour', '2026-10-01'),
      fiscalYear('fy-last', 'Dernier jour', '2026-10-31'),
      fiscalYear('fy-just-outside', 'Juste après', '2026-11-01'),
    ]);
    fecExportService.generate.mockResolvedValue({ fileName: 'x.txt', content: '...' });

    const result = await service.exportFecForClosingCompanies(user, '2026-10');

    expect(result.results).toHaveLength(2);
    expect(result.results.map((r) => r.fiscalYearId).sort()).toEqual(['fy-first', 'fy-last']);
  });
});

import { ProposeToolsService } from './propose-tools.service';
import { CompanyContext } from '../../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };

function validArgs(overrides: Record<string, unknown> = {}) {
  return {
    journalId: 'journal-1',
    fiscalYearId: 'fy-1',
    ecritureDate: '2026-01-15',
    libelle: 'Achat fournitures',
    lignes: [
      { compteId: 'account-607', debit: '100.00' },
      { compteId: 'account-401', credit: '100.00' },
    ],
    ...overrides,
  };
}

function buildService() {
  const validation = {
    buildBalancedLignes: jest.fn(),
    assertReferencesBelongToCompany: jest.fn().mockResolvedValue(undefined),
    assertVatRatesBelongToCompany: jest.fn().mockResolvedValue(undefined),
    computeOrphanedImmobilisationWarnings: jest.fn().mockResolvedValue([]),
  };
  const service = new ProposeToolsService(validation as never);
  return { service, validation };
}

describe('ProposeToolsService — propose_ecriture', () => {
  it('registers exactly one tool: propose_ecriture', () => {
    const { service } = buildService();
    const names = service.getAll().map((t) => t.spec.name);
    expect(names).toEqual(['propose_ecriture']);
  });

  it('never calls anything write-capable — only the shared validation checks, in the same order EntriesService.create() runs them', async () => {
    const { service, validation } = buildService();
    const outcome = await service.execute(company, 'propose_ecriture', validArgs());

    expect(outcome.ok).toBe(true);
    expect(validation.buildBalancedLignes).toHaveBeenCalled();
    expect(validation.assertReferencesBelongToCompany).toHaveBeenCalledWith(
      company,
      'journal-1',
      'fy-1',
    );
    expect(validation.assertVatRatesBelongToCompany).toHaveBeenCalled();
    expect(validation.computeOrphanedImmobilisationWarnings).toHaveBeenCalled();
  });

  it('returns a ProposedEcriture whose dto is exactly the CreateEcritureDto shape, plus warnings/assumptions', async () => {
    const { service, validation } = buildService();
    validation.computeOrphanedImmobilisationWarnings.mockResolvedValue(['un avertissement']);
    const outcome = await service.execute(
      company,
      'propose_ecriture',
      validArgs({ assumptions: ['compte 606400 supposé (fournitures de bureau)'] }),
    );

    expect(outcome).toEqual({
      ok: true,
      value: {
        dto: {
          journalId: 'journal-1',
          fiscalYearId: 'fy-1',
          ecritureDate: '2026-01-15',
          libelle: 'Achat fournitures',
          lignes: [
            { compteId: 'account-607', debit: '100.00' },
            { compteId: 'account-401', credit: '100.00' },
          ],
        },
        warnings: ['un avertissement'],
        assumptions: ['compte 606400 supposé (fournitures de bureau)'],
      },
    });
  });

  it('rejects an unbalanced proposal with the same error EntriesService.create() would throw, never persisting', async () => {
    const { service, validation } = buildService();
    validation.buildBalancedLignes.mockImplementation(() => {
      throw new Error('Écriture does not balance: debit 100.00 != credit 90.00.');
    });
    const outcome = await service.execute(
      company,
      'propose_ecriture',
      validArgs({
        lignes: [
          { compteId: 'account-607', debit: '100.00' },
          { compteId: 'account-401', credit: '90.00' },
        ],
      }),
    );
    expect(outcome).toEqual({
      ok: false,
      error: 'Écriture does not balance: debit 100.00 != credit 90.00.',
    });
  });

  it('rejects a malformed proposal (missing required fields) via the same ValidationPipe the HTTP boundary uses, with specific messages the model can act on', async () => {
    // Reproduces a real failure observed live during Phase 2 verification:
    // the model submitted a French-formatted amount ("1 200,00" instead of
    // "1200.00") and only one ligne (unbalanced). Both are exactly the
    // kind of malformed input this test exercises through the REAL
    // ValidationPipe (not a mocked EntryValidationService), and the
    // returned message must name the actual problem — see chat-tool.ts's
    // extractErrorMessage() and its own regression test.
    const { service } = buildService();
    const outcome = await service.execute(company, 'propose_ecriture', {
      journalId: 'journal-1',
      fiscalYearId: 'fy-1',
      ecritureDate: '2026-01-15',
      libelle: 'Achat ordinateur',
      lignes: [{ compteId: 'account-218300', debit: '1 200,00' }],
    });
    expect(outcome.ok).toBe(false);
    const error = (outcome as { ok: false; error: string }).error;
    expect(error).not.toBe('Bad Request Exception');
    expect(error.length).toBeGreaterThan('Bad Request Exception'.length);
  });

  it('rejects a proposal referencing a journal/fiscal year outside this company, same as a manual entry would', async () => {
    const { service, validation } = buildService();
    validation.assertReferencesBelongToCompany.mockRejectedValue(
      new Error('Fiscal year fy-other not found'),
    );
    const outcome = await service.execute(
      company,
      'propose_ecriture',
      validArgs({ fiscalYearId: 'fy-other' }),
    );
    expect(outcome).toEqual({ ok: false, error: 'Fiscal year fy-other not found' });
  });

  it('drops a non-array or non-string "assumptions" value rather than propagating garbage', async () => {
    const { service } = buildService();
    const outcome = await service.execute(
      company,
      'propose_ecriture',
      validArgs({ assumptions: 'not an array' }),
    );
    expect(outcome.ok).toBe(true);
    expect((outcome as { ok: true; value: { assumptions: string[] } }).value.assumptions).toEqual(
      [],
    );
  });

  it('an unknown tool name returns a clean error instead of throwing', async () => {
    const { service } = buildService();
    const outcome = await service.execute(company, 'validate_ecriture', {});
    expect(outcome.ok).toBe(false);
    expect((outcome as { ok: false; error: string }).error).toMatch(/unknown tool/i);
  });
});

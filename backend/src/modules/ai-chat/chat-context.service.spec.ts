import { ChatContextService } from './chat-context.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };

function buildService() {
  const companies = {
    findCurrent: jest
      .fn()
      .mockResolvedValue({ id: 'company-1', name: 'Société Démo SARL', jurisdiction: 'FR' }),
  };
  const fiscalYears = {
    findAll: jest.fn().mockResolvedValue([
      {
        id: 'fy-2026',
        label: '2026',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        closedAt: null,
      },
    ]),
  };
  const journals = {
    findAll: jest.fn().mockResolvedValue([{ id: 'journal-ac', code: 'AC', label: 'Achats' }]),
  };
  const service = new ChatContextService(
    companies as never,
    fiscalYears as never,
    journals as never,
  );
  return { service, companies, fiscalYears, journals };
}

describe('ChatContextService', () => {
  it('includes the real fiscalYearId and journalId in the formatted context, not just the human labels', async () => {
    const { service } = buildService();
    const context = await service.buildContext(company);

    expect(context).toContain('fiscalYearId="fy-2026"');
    expect(context).toContain('"2026"');
    expect(context).toContain('journalId="journal-ac"');
    expect(context).toContain('code "AC"');
  });

  it('names the company and jurisdiction', async () => {
    const { service } = buildService();
    const context = await service.buildContext(company);
    expect(context).toContain('Société Démo SARL');
    expect(context).toContain('FR');
  });

  it('marks a closed fiscal year as closed and an open one as open', async () => {
    const { service, fiscalYears } = buildService();
    fiscalYears.findAll.mockResolvedValue([
      {
        id: 'fy-2025',
        label: '2025',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
        closedAt: new Date('2026-01-05'),
      },
    ]);
    const context = await service.buildContext(company);
    expect(context).toContain('(clos)');
    expect(context).not.toContain('(ouvert)');
  });

  it('is a thin dispatch onto the three underlying services, scoped to this company', async () => {
    const { service, companies, fiscalYears, journals } = buildService();
    await service.buildContext(company);
    expect(companies.findCurrent).toHaveBeenCalledWith(company);
    expect(fiscalYears.findAll).toHaveBeenCalledWith(company);
    expect(journals.findAll).toHaveBeenCalledWith(company);
  });

  it('handles a company with no fiscal years or journals yet without throwing', async () => {
    const { service, fiscalYears, journals } = buildService();
    fiscalYears.findAll.mockResolvedValue([]);
    journals.findAll.mockResolvedValue([]);
    const context = await service.buildContext(company);
    expect(context).toContain('aucun exercice');
    expect(context).toContain('aucun journal');
  });
});

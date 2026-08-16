import { Injectable } from '@nestjs/common';
import { CompanyContext } from '../../common/tenant/company-context';
import { CompaniesService } from '../companies/companies.service';
import { FiscalYearsService } from '../fiscal-years/fiscal-years.service';
import { JournalsService } from '../journals/journals.service';

/**
 * Eagerly resolves the small, bounded reference data a model needs
 * constantly — which company this is, which fiscal years/journals exist
 * and what their REAL ids are — and formats it into every turn's system
 * prompt, so the model never has to chain a list_fiscal_years/
 * list_journals call just to learn an id it can read directly here.
 *
 * This exists specifically to engineer around a demonstrated model
 * weakness, not as a general "hand the model everything" pattern — see
 * CLAUDE.md "AI chatbot" and specs/ai-chatbot-phase1-implementation-spec.md
 * §6: live testing showed 7-8B local models reliably resolve ids ONLY
 * when given them explicitly, and otherwise guess a human-readable label
 * (e.g. the fiscal year's own "2026" name) instead of calling the tool
 * that would give them the real id. Fiscal years and journals are the
 * two reference kinds every read/write tool actually needs an id for,
 * and both are small, bounded per company (a handful of fiscal years, a
 * handful of journals) — cheap to always include.
 *
 * Deliberately does NOT eagerly inject the chart of accounts: unlike
 * fiscal years/journals, a real company can have hundreds of accounts,
 * so accounts still resolve via the search_accounts tool call. This is a
 * scoping decision, not an oversight — see the implementation spec.
 */
@Injectable()
export class ChatContextService {
  constructor(
    private readonly companies: CompaniesService,
    private readonly fiscalYears: FiscalYearsService,
    private readonly journals: JournalsService,
  ) {}

  async buildContext(company: CompanyContext): Promise<string> {
    const [companyRecord, fiscalYears, journals] = await Promise.all([
      this.companies.findCurrent(company),
      this.fiscalYears.findAll(company),
      this.journals.findAll(company),
    ]);

    const fiscalYearLines =
      fiscalYears
        .map(
          (fy) =>
            `- fiscalYearId="${fy.id}" — "${fy.label}", du ${isoDate(fy.startDate)} au ` +
            `${isoDate(fy.endDate)}${fy.closedAt ? ' (clos)' : ' (ouvert)'}`,
        )
        .join('\n') || '(aucun exercice)';

    const journalLines =
      journals.map((j) => `- journalId="${j.id}" — code "${j.code}" (${j.label})`).join('\n') ||
      '(aucun journal)';

    return [
      `Entreprise actuelle : ${companyRecord.name} (${companyRecord.jurisdiction}).`,
      '',
      'Exercices comptables existants — utilise le fiscalYearId indiqué ci-dessous ' +
        "DIRECTEMENT dans tes appels d'outils. N'appelle PAS list_fiscal_years pour retrouver " +
        'un id déjà listé ici, et n\'invente JAMAIS un id à partir du seul libellé (ex. "2026") ' +
        "— ce libellé n'est PAS un fiscalYearId valide :",
      fiscalYearLines,
      '',
      'Journaux existants — utilise le journalId indiqué ci-dessous directement, même règle :',
      journalLines,
      '',
      "Pour un COMPTE (numéro ou libellé), utilise l'outil search_accounts — la liste des " +
        "comptes n'est volontairement pas préchargée ici (peut être longue).",
    ].join('\n');
  }
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

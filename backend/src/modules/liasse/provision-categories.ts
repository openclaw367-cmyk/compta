import { BadRequestException } from '@nestjs/common';

/**
 * Account-to-nature mapping for 2056 (Provisions inscrites au bilan) —
 * see specs/liasse-2056-2059-implementation-spec.md §2. Every prefix
 * below is a PCG sub-account confirmed against
 * "specs/Reglt 2014-03_Plan comptable general.pdf" (classes 14/15 at
 * around p.129, class 29 at p.128-129, classes 39/49/59's own sections).
 * Longest-prefix-match, same technique as immobilisation-categories.ts —
 * a specific sub-account (e.g. 1511) always wins over its family's
 * documented catch-all (e.g. bare 151).
 *
 * TWO lines fold into their family's "autres" bucket by a DOCUMENTED
 * convention rather than their own dedicated prefix, because the CERFA
 * form names them but the PCG 2014-03 nomenclature has no dedicated
 * account number for either (confirmed absent, not merely unseeded —
 * grepped the full regulation text for both):
 *   - "Provisions pour prêts d'installation (art. 39 quinquies H du
 *     CGI)" — a CGI tax provision with no PCG account at all. Routes to
 *     AUTRES_REGLEMENTEES (148) if a company ever needs it.
 *   - "Provisions pour charges sociales et fiscales sur congés à
 *     payer" — same situation. Routes to AUTRES_RISQUES_CHARGES (158).
 * A third line, "titres mis en équivalence" (dépréciation), has no
 * mapping at all — mise en équivalence is a consolidation-level
 * valuation method, not used in the individual (non-consolidated)
 * accounts this app implements. That row is structurally always 0,00,
 * not a gap.
 */

export interface ProvisionCategory {
  code: string;
  label: string;
  prefixes: string[];
}

export const PROVISION_CATEGORIES: ProvisionCategory[] = [
  // TOTAL I — Provisions réglementées (compte 142-148)
  {
    code: 'RECONSTITUTION_GISEMENTS',
    label: 'Provisions pour reconstitution des gisements miniers et pétroliers',
    prefixes: ['1423'],
  },
  {
    code: 'INVESTISSEMENT',
    label: 'Provisions pour investissement (art. 237 bis A-II du CGI)',
    prefixes: ['1424'],
  },
  // 1431 "hausse des prix" and 1432 "fluctuation des cours" share this one CERFA row — the form
  // prints only "Provisions pour hausse des prix", no separate row for 1432.
  { code: 'HAUSSE_PRIX', label: 'Provisions pour hausse des prix', prefixes: ['143'] },
  { code: 'AMORTISSEMENTS_DEROGATOIRES', label: 'Amortissements dérogatoires', prefixes: ['145'] },
  // 144 (autres éléments d'actif), 146 (réévaluation), 147 (plus-values réinvesties), and 148
  // (autres) have no dedicated CERFA row either — all fold into "Autres provisions réglementées",
  // same as 148 itself. Also where "prêts d'installation" (39 quinquies H) routes — see module doc.
  {
    code: 'AUTRES_REGLEMENTEES',
    label: 'Autres provisions réglementées',
    prefixes: ['144', '146', '147', '148'],
  },

  // TOTAL II — Provisions pour risques et charges (compte 151, 153-158)
  { code: 'LITIGES', label: 'Provisions pour litiges', prefixes: ['1511'] },
  {
    code: 'GARANTIES_CLIENTS',
    label: 'Provisions pour garanties données aux clients',
    prefixes: ['1512'],
  },
  { code: 'AMENDES_PENALITES', label: 'Provisions pour amendes et pénalités', prefixes: ['1514'] },
  { code: 'PERTES_CHANGE', label: 'Provisions pour pertes de change', prefixes: ['1515'] },
  {
    code: 'PENSIONS',
    label: 'Provisions pour pensions et obligations similaires',
    prefixes: ['153'],
  },
  { code: 'IMPOTS', label: 'Provisions pour impôts', prefixes: ['155'] },
  {
    code: 'RENOUVELLEMENT_IMMOBILISATIONS',
    label: 'Provisions pour renouvellement des immobilisations',
    prefixes: ['156'],
  },
  {
    code: 'GROS_ENTRETIEN',
    label: 'Provisions pour gros entretien et grandes révisions',
    prefixes: ['1572'],
  },
  // Catch-all: bare 151 (1513 pertes sur marchés à terme, 1516 pertes sur contrats, 1518 autres —
  // none has its own CERFA row), 154 (restructurations), bare 157 (anything but 1572), and 158
  // (already itself "autres provisions pour charges"). Also where "congés à payer" routes.
  {
    code: 'AUTRES_RISQUES_CHARGES',
    label: 'Autres provisions pour risques et charges',
    prefixes: ['151', '154', '157', '158'],
  },

  // TOTAL III — Provisions pour dépréciation (comptes 29x/39x/49x/59x)
  {
    code: 'DEPREC_INCORPORELLES',
    label: 'Dépréciations — immobilisations incorporelles',
    prefixes: ['290', '2932'],
  },
  {
    code: 'DEPREC_CORPORELLES',
    label: 'Dépréciations — immobilisations corporelles',
    prefixes: ['291', '292', '2931'],
  },
  // No prefix here, deliberately — see module doc comment (titres mis en équivalence).
  {
    code: 'DEPREC_TITRES_PARTICIPATION',
    label: 'Dépréciations — titres de participations',
    prefixes: ['296'],
  },
  {
    code: 'DEPREC_AUTRES_IMMO_FINANCIERES',
    label: 'Dépréciations — autres immobilisations financières',
    prefixes: ['297'],
  },
  {
    code: 'DEPREC_STOCKS_EN_COURS',
    label: 'Dépréciations — sur stocks et en cours',
    prefixes: ['39'],
  },
  {
    code: 'DEPREC_COMPTES_CLIENTS',
    label: 'Dépréciations — sur comptes clients',
    prefixes: ['491'],
  },
  // Catch-all: other class-4 receivables (495/496) and VMP (590) — neither is a "compte client" nor
  // an immobilisation nor a stock, so both land on the form's own "Autres provisions pour
  // dépréciation" row.
  { code: 'DEPREC_AUTRES', label: 'Autres provisions pour dépréciation', prefixes: ['49', '59'] },
];

/** Every prefix a provision/dépréciation account can start with — used by the caller to pre-filter the full ledger down to this table's accounts before classification. */
export const PROVISION_ACCOUNT_CLASS_PREFIXES = ['14', '15', '29', '39', '49', '59'];

export function resolveProvisionCategory(accountNumber: string): ProvisionCategory {
  let best: { category: ProvisionCategory; prefixLength: number } | null = null;
  for (const category of PROVISION_CATEGORIES) {
    for (const prefix of category.prefixes) {
      if (accountNumber.startsWith(prefix) && (!best || prefix.length > best.prefixLength)) {
        best = { category, prefixLength: prefix.length };
      }
    }
  }
  if (!best) {
    throw new BadRequestException(
      `Account "${accountNumber}" has no 2056 provision-nature mapping — see ` +
        'specs/liasse-2056-2059-implementation-spec.md §2.',
    );
  }
  return best.category;
}

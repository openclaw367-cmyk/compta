import { Money } from '../../common/decimal';
import { ProvisionMovementLigne } from './tableau-2056';

/**
 * Hand-computed oracle for 2056 — see tableau-2056.spec.ts and
 * liasse-articulation.spec.ts. Two provisions, both created fresh within
 * the reported year (no à-nouveau line for either — "début" from a
 * prior year is exercised separately by the AN-vs-non-AN split test in
 * tableau-2056.spec.ts itself, which doesn't need a whole fixture).
 * Deliberately NOT account 151100 — that's already used by
 * liasse-oracle-fixture.ts's own provision (T21, feeding its DP line),
 * and this fixture gets combined with that one in
 * liasse-articulation.spec.ts's assertTableau2056TiesToBilan tests, so
 * reusing the same account number would double up rather than add a
 * second, independent provision:
 *
 *   - 151200 "Provisions pour garanties données aux clients": dotation
 *     5 000,00 (2026-05-01), partial reprise 2 000,00 (2026-08-01) →
 *     fin 3 000,00.
 *   - 491000 "Dépréciation clients douteux": dotation 1 200,00
 *     (2026-05-01), no reprise → fin 1 200,00.
 *
 * This is also posted live, as the same four écritures, into the
 * "Société Test Multi-Année" fixture company (see CLAUDE.md's "Test
 * fixtures" section) against a real 411000 "Clients" receivable so the
 * bilan's BY (clients dépréciation) line has a non-negative net to sit
 * against — a standalone dépréciation with no underlying receivable
 * would be nonsensical, not just untested.
 *
 * Expected: TOTAL I (réglementées) = 0,00. TOTAL II (risques et
 * charges) = 3 000,00 (GARANTIES_CLIENTS only). TOTAL III
 * (dépréciation) = 1 200,00 (DEPREC_COMPTES_CLIENTS only). TOTAL
 * GÉNÉRAL = 4 200,00.
 */
export const ORACLE_2056_LIGNES: ProvisionMovementLigne[] = [
  // Dotation — provisions pour garanties données aux clients (151200 credited, 681500 debited —
  // not itself a provision account, so never passed to computeTableau2056; the counterpart side
  // is irrelevant to this module, only noted here as commentary on the live posting.
  {
    accountNumber: '151200',
    isOpeningBalance: false,
    debit: Money.zero(),
    credit: Money.fromString('5000.00'),
  },
  // Reprise partielle — même provision (151200 debited, 781000 credited).
  {
    accountNumber: '151200',
    isOpeningBalance: false,
    debit: Money.fromString('2000.00'),
    credit: Money.zero(),
  },
  // Dotation — dépréciation clients douteux (491000 credited, 681700 debited).
  {
    accountNumber: '491000',
    isOpeningBalance: false,
    debit: Money.zero(),
    credit: Money.fromString('1200.00'),
  },
];

export const ORACLE_2056_TOTALS = {
  totalReglementees: '0.00',
  totalRisquesCharges: '3000.00',
  totalDepreciation: '1200.00',
  totalGeneral: '4200.00',
};

import { Prisma } from '@prisma/client';
import { Money } from '../../common/decimal';
import { LiasseLigne } from './trial-balance-engine';
import { ImmobilisationMovementAsset } from './tableau-2054';
import { ImmobilisationDepreciationMovement } from './tableau-2055';

/**
 * Shared hand-computed, multi-asset, multi-year oracle for 2054/2055 —
 * see tableau-2054.spec.ts, tableau-2055.spec.ts, and
 * tableau-2054-2055-articulation.spec.ts. FY2025 establishes "début"
 * balances (assets acquired and dotations posted in a prior, already-
 * closed year); FY2026 is the reported year, with its own new
 * acquisitions (Entrepôt C, Ordinateurs E) and its own dotations on
 * every depreciable asset.
 *
 * Hand-computed (see each *.spec.ts for the full per-category trace):
 *   2054 fin total (corporelles only, no incorporelles/financières in
 *   this fixture) = 390 000,00. 2055 fin total = 38 600,00. Net =
 *   351 400,00 — ties to the bilan's AN+AP+AR+AT net computed from the
 *   same FY2026 ledger fixture below (also 351 400,00).
 */
function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export const FY_2025 = {
  id: 'fy-2025',
  startDate: new Date('2025-01-01'),
  endDate: new Date('2025-12-31'),
};
export const FY_2026 = {
  id: 'fy-2026',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
};

export const ORACLE_ASSETS: ImmobilisationMovementAsset[] = [
  {
    accountNumber: '211000',
    acquisitionDate: new Date('2025-03-01'),
    acquisitionValue: Money.fromString('50000.00'),
    cessionDate: null,
  }, // Terrain A
  {
    accountNumber: '213000',
    acquisitionDate: new Date('2025-06-01'),
    acquisitionValue: Money.fromString('200000.00'),
    cessionDate: null,
  }, // Bâtiment B
  {
    accountNumber: '214000',
    acquisitionDate: new Date('2026-04-01'),
    acquisitionValue: Money.fromString('80000.00'),
    cessionDate: null,
  }, // Entrepôt C
  {
    accountNumber: '215400',
    acquisitionDate: new Date('2025-09-01'),
    acquisitionValue: Money.fromString('30000.00'),
    cessionDate: null,
  }, // Machine D
  {
    accountNumber: '218300',
    acquisitionDate: new Date('2026-02-01'),
    acquisitionValue: Money.fromString('6000.00'),
    cessionDate: null,
  }, // Ordinateurs E
  {
    accountNumber: '218200',
    acquisitionDate: new Date('2025-01-10'),
    acquisitionValue: Money.fromString('24000.00'),
    cessionDate: null,
  }, // Véhicule F
];

/** An asset acquired AFTER FY2026 ends — used only by the out-of-period guard tests, never the main oracle. */
export const LATER_ASSET: ImmobilisationMovementAsset = {
  accountNumber: '218300',
  acquisitionDate: new Date('2027-01-15'),
  acquisitionValue: Money.fromString('9999.00'),
  cessionDate: null,
};

export const ORACLE_DEPRECIATION_ENTRIES: ImmobilisationDepreciationMovement[] = [
  // Bâtiment B — 213000
  {
    accountNumber: '213000',
    fiscalYearId: FY_2025.id,
    fiscalYearEndDate: FY_2025.endDate,
    amount: Money.fromString('10000.00'),
  },
  {
    accountNumber: '213000',
    fiscalYearId: FY_2026.id,
    fiscalYearEndDate: FY_2026.endDate,
    amount: Money.fromString('10000.00'),
  },
  // Machine D — 215400
  {
    accountNumber: '215400',
    fiscalYearId: FY_2025.id,
    fiscalYearEndDate: FY_2025.endDate,
    amount: Money.fromString('3000.00'),
  },
  {
    accountNumber: '215400',
    fiscalYearId: FY_2026.id,
    fiscalYearEndDate: FY_2026.endDate,
    amount: Money.fromString('3000.00'),
  },
  // Véhicule F — 218200
  {
    accountNumber: '218200',
    fiscalYearId: FY_2025.id,
    fiscalYearEndDate: FY_2025.endDate,
    amount: Money.fromString('6000.00'),
  },
  {
    accountNumber: '218200',
    fiscalYearId: FY_2026.id,
    fiscalYearEndDate: FY_2026.endDate,
    amount: Money.fromString('6000.00'),
  },
  // Ordinateurs E — 218300 (acquired this year, first dotation already posted this year)
  {
    accountNumber: '218300',
    fiscalYearId: FY_2026.id,
    fiscalYearEndDate: FY_2026.endDate,
    amount: Money.fromString('600.00'),
  },
  // Terrain A (211000) and Entrepôt C (214000): no dotations at all.
];

/** An out-of-period entry — used only by the guard tests. */
export const LATER_DEPRECIATION_ENTRY: ImmobilisationDepreciationMovement = {
  accountNumber: '218300',
  fiscalYearId: 'fy-2027',
  fiscalYearEndDate: new Date('2027-12-31'),
  amount: Money.fromString('600.00'),
};

/**
 * FY2026's own ledger — an opening (à-nouveau-equivalent) block carrying
 * forward every FY2025-acquired asset's brut value and accumulated
 * amortissements (plus a starting cash position and a capital plug so
 * the whole block balances on its own), followed by this year's real
 * activity: the two new acquisitions and every asset's FY2026 dotation.
 */
export const ORACLE_BILAN_LIGNES: LiasseLigne[] = [
  // Opening (à-nouveau)
  { compteNumber: '512000', pcgClass: 5, debit: d('100000.00'), credit: d('0.00') },
  { compteNumber: '211000', pcgClass: 2, debit: d('50000.00'), credit: d('0.00') },
  { compteNumber: '213000', pcgClass: 2, debit: d('200000.00'), credit: d('0.00') },
  { compteNumber: '215400', pcgClass: 2, debit: d('30000.00'), credit: d('0.00') },
  { compteNumber: '218200', pcgClass: 2, debit: d('24000.00'), credit: d('0.00') },
  { compteNumber: '281300', pcgClass: 2, debit: d('0.00'), credit: d('10000.00') },
  { compteNumber: '281540', pcgClass: 2, debit: d('0.00'), credit: d('3000.00') },
  { compteNumber: '281800', pcgClass: 2, debit: d('0.00'), credit: d('6000.00') },
  { compteNumber: '101000', pcgClass: 1, debit: d('0.00'), credit: d('385000.00') },
  // This year's acquisitions
  { compteNumber: '214000', pcgClass: 2, debit: d('80000.00'), credit: d('0.00') },
  { compteNumber: '512000', pcgClass: 5, debit: d('0.00'), credit: d('80000.00') },
  { compteNumber: '218300', pcgClass: 2, debit: d('6000.00'), credit: d('0.00') },
  { compteNumber: '512000', pcgClass: 5, debit: d('0.00'), credit: d('6000.00') },
  // This year's dotations
  { compteNumber: '681100', pcgClass: 6, debit: d('10000.00'), credit: d('0.00') },
  { compteNumber: '281300', pcgClass: 2, debit: d('0.00'), credit: d('10000.00') },
  { compteNumber: '681100', pcgClass: 6, debit: d('3000.00'), credit: d('0.00') },
  { compteNumber: '281540', pcgClass: 2, debit: d('0.00'), credit: d('3000.00') },
  { compteNumber: '681100', pcgClass: 6, debit: d('6000.00'), credit: d('0.00') },
  { compteNumber: '281800', pcgClass: 2, debit: d('0.00'), credit: d('6000.00') },
  { compteNumber: '681100', pcgClass: 6, debit: d('600.00'), credit: d('0.00') },
  { compteNumber: '281800', pcgClass: 2, debit: d('0.00'), credit: d('600.00') },
];

/** HN for this fixture: only charge is 681100 (19 600,00 dotations), no revenue — a loss. */
export const ORACLE_HN = '-19600.00';

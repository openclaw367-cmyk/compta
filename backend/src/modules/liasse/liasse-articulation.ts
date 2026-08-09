import { ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { Bilan2050 } from './bilan-2050';

/**
 * The oracle — see specs/liasse-2050-implementation-spec.md §5. Only two
 * of the originally-considered checks remain genuinely independent
 * cross-checks after the DI correction (§5.2): Actif = Passif (this
 * module) and the VNC tie-out (also this module). Everything else
 * (subtotal formulas, HN feeding DI) is enforced by construction inside
 * the compute functions themselves, not re-verified here.
 */

export interface VncCheckLine {
  /** The bilan Actif line code this group of FixedAssets rolls up to (e.g. "AP" for Constructions). */
  code: string;
  /** Sum of FixedAsset.acquisitionValue for assets whose account falls under this line. */
  valeurBrute: Money;
  /** Sum of posted DepreciationEntry.amount for those same assets. */
  amortissementsCumules: Money;
}

/**
 * Actif Net (CO − 1A) must equal Passif total (EE). Genuinely
 * independent: Actif is built only from asset-nature accounts, Passif
 * only from liability/equity-nature accounts (plus DI, itself built from
 * HN, which draws on classes 6/7 — neither Actif nor the rest of
 * Passif). See spec §5.1 for the full reasoning.
 */
function assertBilanBalances(bilan: Bilan2050): void {
  const actifNet = Money.fromString(bilan.totalActifNet);
  const passifTotal = Money.fromString(bilan.totalPassif);
  if (!actifNet.equals(passifTotal)) {
    throw new ConflictException(
      `Bilan does not balance: Actif net (${actifNet.toApiString()}) ≠ Passif total ` +
        `(${passifTotal.toApiString()}). This means an account was misclassified, double-counted, ` +
        'or dropped by the mapping — never a case to silently accept.',
    );
  }
}

/**
 * The immobilisations module's VNC (fixed-asset-invariants.ts,
 * independently sourced from FixedAsset.acquisitionValue and posted
 * DepreciationEntry.amount — never re-reading the ledger's 21x/28x
 * balances) must tie to the same lines' ledger-derived Brut/
 * Amortissements. A real cross-check between two independently-sourced
 * numbers — see spec §5.4.
 */
function assertVncTiesToLedger(bilan: Bilan2050, vncByLine: VncCheckLine[]): void {
  const actifByCode = new Map(bilan.actif.map((l) => [l.code, l]));
  for (const line of vncByLine) {
    const ledgerLine = actifByCode.get(line.code);
    if (!ledgerLine) {
      continue;
    }
    const ledgerBrut = Money.fromString(ledgerLine.brut);
    const ledgerAmort = Money.fromString(ledgerLine.amortissements);
    if (!line.valeurBrute.equals(ledgerBrut)) {
      throw new ConflictException(
        `Ligne ${line.code}: immobilisations module's valeur brute ` +
          `(${line.valeurBrute.toApiString()}) ≠ ledger-derived Brut (${ledgerBrut.toApiString()}). ` +
          'Either an acquisition écriture bypassed the immobilisations module, or a FixedAsset is ' +
          'assigned to the wrong account.',
      );
    }
    if (!line.amortissementsCumules.equals(ledgerAmort)) {
      throw new ConflictException(
        `Ligne ${line.code}: immobilisations module's amortissements cumulés ` +
          `(${line.amortissementsCumules.toApiString()}) ≠ ledger-derived Amortissements ` +
          `(${ledgerAmort.toApiString()}). A dotation may not have been posted correctly.`,
      );
    }
  }
}

export function assertLiasseArticulation(input: {
  bilan: Bilan2050;
  vncByLine: VncCheckLine[];
}): void {
  assertBilanBalances(input.bilan);
  assertVncTiesToLedger(input.bilan, input.vncByLine);
}

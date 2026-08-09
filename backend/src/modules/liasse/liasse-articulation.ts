import { ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { Bilan2050 } from './bilan-2050';
import { Tableau2054 } from './tableau-2054';
import { Tableau2055 } from './tableau-2055';
import { Tableau2056 } from './tableau-2056';
import { TrialBalanceAccount } from './trial-balance-engine';
import { PROVISION_ACCOUNT_CLASS_PREFIXES } from './provision-categories';

/**
 * The oracle — see specs/liasse-2050-implementation-spec.md §5 and
 * specs/liasse-2054-2055-implementation-spec.md §6. Only three checks
 * remain genuinely independent cross-checks: Actif = Passif, the VNC
 * tie-out, and (once 2054/2055 are wired into LiasseService.generate())
 * the 2054/2055 movement-table tie-out. Everything else (subtotal
 * formulas, HN feeding DI) is enforced by construction inside the
 * compute functions themselves, not re-verified here.
 */

/**
 * Every bilan Actif line that's an immobilisation (brut/amort pair
 * sourced from class 2, before Stocks/Créances/Disponibilités start) —
 * see bilan-2050.ts's ACTIF_ROWS. Used to sum "total immobilisations
 * net" for the 2054/2055 tie-out below, since Bilan2050 doesn't expose
 * that subtotal directly (only the grand Actif total, which also
 * includes non-immobilisation lines).
 */
const IMMOBILISATION_BILAN_CODES = [
  'AB',
  'CX',
  'AF',
  'AH',
  'AJ',
  'AL',
  'AN',
  'AP',
  'AR',
  'AT',
  'AV',
  'CS',
  'CU',
  'BB',
  'BD',
  'BF',
  'BH',
];

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

/**
 * The annexe's version of Actif=Passif: 2054's ending brut minus 2055's
 * ending amortissements, summed across every category (incorporelles +
 * corporelles + financières), must equal the bilan's total
 * immobilisations net. One aggregate identity, not a per-line check —
 * 2054/2055 group several categories differently than bilan-2050.ts
 * does (see specs/liasse-2054-2055-implementation-spec.md §3c/§3d), so
 * comparing per-bilan-line would mean re-deriving that same grouping
 * logic a second time for no extra rigor. This doesn't need its own
 * separate tie to the immobilisations module's VNC either: VNC already
 * ties to the bilan via assertVncTiesToLedger above, so tying 2054/2055
 * to that same bilan figure closes the loop transitively.
 */
export function assertTableauxTieToBilan(input: {
  bilan: Bilan2050;
  tableau2054: Tableau2054;
  tableau2055: Tableau2055;
}): void {
  const bilanImmobilisationsNet = input.bilan.actif
    .filter((l) => IMMOBILISATION_BILAN_CODES.includes(l.code))
    .reduce((sum, l) => sum.plus(Money.fromString(l.net)), Money.zero());

  const tableauxNet = Money.fromString(input.tableau2054.totalGeneral).minus(
    Money.fromString(input.tableau2055.totalGeneral),
  );

  if (!bilanImmobilisationsNet.equals(tableauxNet)) {
    throw new ConflictException(
      `2054 (${input.tableau2054.totalGeneral}) − 2055 (${input.tableau2055.totalGeneral}) = ` +
        `${tableauxNet.toApiString()}, which does not equal the bilan's total immobilisations net ` +
        `(${bilanImmobilisationsNet.toApiString()}). This means the 2054/2055 movement data and the ` +
        "ledger have drifted apart — an acquisition or dotation didn't post consistently on both " +
        'sides.',
    );
  }
}

/**
 * 2056's own version of the same idea, but comparing two INDEPENDENT
 * derivations of the same number rather than tying to a bilan subtotal
 * (the bilan doesn't expose one — its "amortissements" column mixes 28x
 * amortissement with 29x dépréciation per asset line, e.g. AO combines
 * 2811+2911, so there is no clean bilan figure to tie to the way 2054/
 * 2055 tie to "total immobilisations net"). Path A: 2056's own
 * TOTAL GÉNÉRAL, built by classifying every provision/dépréciation
 * account into a nature line (provision-categories.ts). Path B: a flat
 * sum of the SAME accounts' closing balances straight off the trial
 * balance, by prefix only, with no classification logic at all. If a
 * provision account were ever double-counted or dropped by the
 * classification, the two paths would disagree — same spirit as
 * assertVncTiesToLedger's two-independently-sourced-numbers check.
 */
function assertTableau2056TiesToTrialBalance(
  trialBalance: TrialBalanceAccount[],
  tableau2056: Tableau2056,
): void {
  const rawTotal = trialBalance
    .filter((a) => PROVISION_ACCOUNT_CLASS_PREFIXES.some((p) => a.accountNumber.startsWith(p)))
    .reduce((sum, a) => sum.minus(a.balance), Money.zero()); // credit direction: −(debit−credit)

  const tableauTotal = Money.fromString(tableau2056.totalGeneral);
  if (!rawTotal.equals(tableauTotal)) {
    throw new ConflictException(
      `2056's TOTAL GÉNÉRAL (${tableauTotal.toApiString()}) does not equal the raw trial-balance sum ` +
        `of every provision/dépréciation account (${rawTotal.toApiString()}). This means the 2056 ` +
        'nature-line classification double-counted, dropped, or misdirected an account — a mapping ' +
        'bug, not a data problem.',
    );
  }
}

export function assertTableau2056TiesToBilan(input: {
  trialBalance: TrialBalanceAccount[];
  tableau2056: Tableau2056;
}): void {
  assertTableau2056TiesToTrialBalance(input.trialBalance, input.tableau2056);
}

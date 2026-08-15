import { BadRequestException, NotImplementedException } from '@nestjs/common';

/**
 * Account resolution/validation for the cession écriture — see CLAUDE.md
 * "Immobilisations / cession" and specs/Reglt 2014-03_Plan comptable
 * general.pdf Art. 942-20 / Art. 944-46. Mirrors
 * fixed-asset-invariants.ts's assertValidAccountTriplet in spirit (throw
 * rather than guess), kept as a separate module since it's about the
 * DISPOSAL écriture's accounts, not the FixedAsset's own creation-time
 * triplet.
 */

export type CessionNature = 'INCORPORELLE' | 'CORPORELLE';

/**
 * 675x/775x account numbers per nature — confirmed against the PCG's own
 * sub-account numbering (6751/7751 incorporelles, 6752/7752 corporelles;
 * see backend/src/modules/liasse/compte-resultat-2052-2053.ts's existing
 * F1/G1 routing, built the same way). Not caller-supplied: resolved
 * automatically from the FixedAsset's own account, same "require it to
 * already exist, never auto-create" discipline as a-nouveau.service.ts's
 * RESULTAT_BENEFICE_ACCOUNT/RESULTAT_PERTE_ACCOUNT.
 */
export const CESSION_ACCOUNTS: Record<CessionNature, { vnc: string; produit: string }> = {
  INCORPORELLE: { vnc: '675100', produit: '775100' },
  CORPORELLE: { vnc: '675200', produit: '775200' },
};

/**
 * Resolves whether a FixedAsset's own class-2 account is incorporelle
 * (20x) or corporelle (21x and the 218x family) for cession-account
 * routing purposes. Financières (26x/27x — participations, titres) are
 * explicitly rejected: no fixture data or real usage in this app's
 * DepreciationService exercises a financial immobilisation, and PCG Art.
 * 944-46's TIAP treatment is a genuinely different pattern (462 credited
 * by 775 OR debited by 675 depending on gain/loss, never both) — not
 * attempted here.
 */
export function resolveCessionNature(accountNumber: string): CessionNature {
  if (accountNumber.startsWith('20')) {
    return 'INCORPORELLE';
  }
  if (accountNumber.startsWith('26') || accountNumber.startsWith('27')) {
    throw new NotImplementedException(
      `Account "${accountNumber}" is a financial immobilisation (participations/titres) — cession ` +
        "for this category isn't implemented (PCG Art. 944-46's TIAP treatment is a different " +
        'pattern from the standard corporelle/incorporelle one built here).',
    );
  }
  if (accountNumber.startsWith('28') || accountNumber.startsWith('29')) {
    throw new BadRequestException(
      `Account "${accountNumber}" is an amortissements/dépréciations contra-account, not a valid ` +
        'immobilisation account for cession.',
    );
  }
  return 'CORPORELLE';
}

interface AccountRef {
  number: string;
  pcgClass: number;
}

/**
 * The compte de règlement (where the sale proceeds land) — per the
 * confirmed decision, caller-supplied rather than hardcoded to 462:
 * either 462 "Créances sur cessions d'immobilisations" (paid later,
 * reconciled by a normal separate écriture — mirrors how 411 client
 * receivables already work in this app) or an immediate class-5 cash/
 * bank account (512, 530, ...). Anything else is rejected.
 */
export function assertValidCompteReglement(account: AccountRef): void {
  if (account.number.startsWith('462') || account.pcgClass === 5) {
    return;
  }
  throw new BadRequestException(
    `Account "${account.number}" is not a valid compte de règlement for a cession — expected a ` +
      '462-prefixed créance account or a class-5 (financier) account.',
  );
}

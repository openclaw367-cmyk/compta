import { ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';

/**
 * 2059-A-SD (Détermination des plus et moins-values) — see
 * specs/liasse-2056-2059-implementation-spec.md §4 and CLAUDE.md
 * "Immobilisations / cession" for the écriture side this table reads
 * off of.
 *
 * The real form has SIX Cadre A columns (nature+date, valeur d'origine,
 * valeur nette réévaluée, amortissements pratiqués en franchise
 * d'impôt, autres amortissements, valeur résiduelle) and Cadre B splits
 * the plus/moins-value by court-terme (col 9) / long-terme (col 10) /
 * taxable à 19% (col 11) — a genuine CGI tax-qualification judgment
 * call (holding period, nature of the gain) this app does not attempt.
 * What IS computed, mechanically, from data this app already has:
 *  - Cadre A: valeur d'origine (acquisitionValue), amortissements
 *    (posted dotations cumulés at disposal), valeur résiduelle (VNC) —
 *    "valeur nette réévaluée" and "amortissements en franchise d'impôt"
 *    are structurally N/A (no revaluation feature, no tax/book
 *    amortization divergence — this app only computes linéaire, same
 *    reasoning as 2055's Cadre B being N/A).
 *  - Cadre B: prix de vente (cessionPrice), montant global de la
 *    plus/moins-value (cessionPrice − VNC) — the qualification column
 *    stays `null`, and totalCourtTerme/totalLongTerme stay "0.00" even
 *    when real disposals are present, since allocating between them
 *    needs the tax judgment this pass doesn't attempt. The real,
 *    computed net total is still surfaced via `totalNonQualifie` so the
 *    figure isn't silently dropped — same "flag, don't fake" discipline
 *    as 2057's maturity split.
 */

export interface Tableau2059AAsset {
  accountNumber: string;
  /** Guaranteed non-null and within the reported fiscal year — the caller pre-filters to disposals this year, same convention as 2054/2055/2056. */
  cessionDate: Date;
  cessionPrice: Money;
  /** Always FixedAsset.acquisitionValue — see fixed-asset-invariants.ts's own doc comment on why valeurBrute never reads any other field. */
  valeurBrute: Money;
  /** Sum of this asset's posted dotations, up to and including the disposal year's own (possibly prorated) final entry. */
  amortissementsCumules: Money;
}

/** Cadre A row — valeur résiduelle des éléments cédés. See module doc comment for why "valeur nette réévaluée" and "amortissements en franchise d'impôt" aren't represented. */
export interface Tableau2059ACadreARow {
  accountNumber: string;
  valeurOrigine: string;
  amortissements: string;
  valeurResiduelle: string;
}

/** Cadre B row — plus-values/moins-values. `qualification` is always null this pass — see module doc comment. */
export interface Tableau2059ACadreBRow {
  accountNumber: string;
  prixDeVente: string;
  plusOuMoinsValue: string;
  qualification: 'COURT_TERME' | 'LONG_TERME' | null;
}

export interface Tableau2059A {
  cadreA: Tableau2059ACadreARow[];
  cadreB: Tableau2059ACadreBRow[];
  /** CADRE A total — plus/moins-value nette à court terme. Always "0.00" — see module doc comment. */
  totalCourtTerme: string;
  /** CADRE B total — plus/moins-value nette à long terme. Always "0.00" — see module doc comment. */
  totalLongTerme: string;
  /** The real, computed net plus/moins-value across every disposal this year, not yet allocated between court/long terme. */
  totalNonQualifie: string;
  note: string;
}

const NOTE =
  "La qualification fiscale (court terme / long terme / taxable à 19 %) n'est pas calculée : elle " +
  "dépend d'une analyse fiscale (durée de détention, nature du bien) que cette application ne fait " +
  "pas. Le montant global de la plus ou moins-value par cession est calculé (prix de cession − " +
  'valeur résiduelle) et apparaît dans « totalNonQualifie » plutôt que réparti entre CADRE A et ' +
  'CADRE B.';

const EMPTY_NOTE =
  "Aucune cession d'immobilisation n'a eu lieu au cours de cet exercice.";

/**
 * Pure computation, no I/O. `disposedAssets` must already be scoped by
 * the caller to assets whose cessionDate falls within the reported
 * fiscal year — this function defensively re-checks that, same
 * precondition/re-check pattern as tableau-2054/2055/2056.
 */
export function computeTableau2059A(
  disposedAssets: Tableau2059AAsset[],
  fiscalYear: { startDate: Date; endDate: Date },
): Tableau2059A {
  for (const asset of disposedAssets) {
    if (asset.cessionDate < fiscalYear.startDate || asset.cessionDate > fiscalYear.endDate) {
      throw new ConflictException(
        `Asset with account "${asset.accountNumber}" has a cessionDate ` +
          `(${asset.cessionDate.toISOString().slice(0, 10)}) outside the reported fiscal year ` +
          `(${fiscalYear.startDate.toISOString().slice(0, 10)} – ` +
          `${fiscalYear.endDate.toISOString().slice(0, 10)}) — it must be excluded by the caller ` +
          'before computing 2059-A, not passed in.',
      );
    }
  }

  const cadreA: Tableau2059ACadreARow[] = disposedAssets.map((asset) => ({
    accountNumber: asset.accountNumber,
    valeurOrigine: asset.valeurBrute.toApiString(),
    amortissements: asset.amortissementsCumules.toApiString(),
    valeurResiduelle: asset.valeurBrute.minus(asset.amortissementsCumules).toApiString(),
  }));

  const cadreB: Tableau2059ACadreBRow[] = disposedAssets.map((asset) => {
    const vnc = asset.valeurBrute.minus(asset.amortissementsCumules);
    return {
      accountNumber: asset.accountNumber,
      prixDeVente: asset.cessionPrice.toApiString(),
      plusOuMoinsValue: asset.cessionPrice.minus(vnc).toApiString(),
      qualification: null,
    };
  });

  const totalNonQualifie = cadreB
    .reduce((sum, row) => sum.plus(Money.fromString(row.plusOuMoinsValue)), Money.zero())
    .toApiString();

  return {
    cadreA,
    cadreB,
    totalCourtTerme: '0.00',
    totalLongTerme: '0.00',
    totalNonQualifie,
    note: disposedAssets.length > 0 ? NOTE : EMPTY_NOTE,
  };
}

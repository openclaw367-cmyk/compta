import { ConflictException } from '@nestjs/common';

/**
 * 2059-A-SD (Détermination des plus et moins-values) — see
 * specs/liasse-2056-2059-implementation-spec.md §4.
 *
 * Every row on the real form (Cadre A — valeur résiduelle des éléments
 * cédés; Cadre B — plus-values/moins-values, qualification court terme
 * / long terme / taxable à 19%) is a per-disposal line item. Cession
 * logic doesn't exist in this app yet (see CLAUDE.md "Known scope
 * boundaries" — FixedAsset.cessionDate/cessionPrice exist in the schema
 * but stay null; no DTO/UI surface, no plus/moins-value computation).
 * So unlike 2054/2055 (which had real non-cession movement to show even
 * with their cession columns pinned to 0,00), 2059-A has nothing at all
 * to report today — not a partial table, a structurally empty one.
 *
 * This is not a silent no-op: it asserts that no FixedAsset in the
 * reported fiscal year actually has a cessionDate set. If one ever
 * does, returning an empty table would be actively wrong (a real
 * disposal happened and the tax plus-value/moins-value on it would be
 * missing from the filing), so this throws instead — a future cession
 * feature must touch this guard (and build the actual qualification
 * logic, deliberately out of scope here) before it can be relaxed.
 */

export interface FixedAssetCessionCheck {
  id: string;
  accountNumber: string;
  cessionDate: Date | null;
}

/** Cadre A row shape (valeur résiduelle des éléments cédés) — defined for forward-compatibility with a future cession feature; never populated by this pass. */
export interface Tableau2059ACadreARow {
  accountNumber: string;
  valeurOrigine: string;
  amortissements: string;
  valeurResiduelle: string;
}

/** Cadre B row shape (plus-values/moins-values) — same forward-compatibility note as Cadre A. */
export interface Tableau2059ACadreBRow {
  accountNumber: string;
  prixDeVente: string;
  plusOuMoinsValue: string;
  qualification: 'COURT_TERME' | 'LONG_TERME';
}

export interface Tableau2059A {
  /** Always empty — see module doc comment. */
  cadreA: Tableau2059ACadreARow[];
  /** Always empty — see module doc comment. */
  cadreB: Tableau2059ACadreBRow[];
  /** CADRE A total — plus/moins-value nette à court terme. Always "0.00" this pass. */
  totalCourtTerme: string;
  /** CADRE B total — plus/moins-value nette à long terme. Always "0.00" this pass. */
  totalLongTerme: string;
  note: string;
}

const NOTE =
  "Les cessions d'immobilisations ne sont pas encore prises en charge dans cette application — " +
  'aucune ligne ne peut être produite tant que la logique de cession (calcul de la plus ou moins-' +
  "value, qualification court terme / long terme) n'est pas implémentée.";

/**
 * Pure computation, no I/O. `assets` should be every FixedAsset in
 * scope for the reported fiscal year (same set fetchImmobilisations
 * already retrieves for the VNC check and 2054/2055 — no separate
 * query needed).
 */
export function computeTableau2059A(assets: FixedAssetCessionCheck[]): Tableau2059A {
  const withCession = assets.filter((a) => a.cessionDate != null);
  if (withCession.length > 0) {
    throw new ConflictException(
      `${withCession.length} FixedAsset(s) have a cessionDate set (e.g. account ` +
        `"${withCession[0].accountNumber}"), but 2059-A's plus-value/moins-value computation isn't ` +
        'implemented — generating an empty table would silently omit a real disposal from the ' +
        'filing. Cession support must be built (see specs/liasse-2056-2059-implementation-spec.md ' +
        '§4) before a liasse can be generated for a fiscal year with any cession in it.',
    );
  }

  return {
    cadreA: [],
    cadreB: [],
    totalCourtTerme: '0.00',
    totalLongTerme: '0.00',
    note: NOTE,
  };
}

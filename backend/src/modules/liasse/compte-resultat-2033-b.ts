import { Money } from '../../common/decimal';
import { TrialBalanceAccount } from './trial-balance-engine';
import { LineRule, classifyAccounts } from './liasse-line-rules';

/**
 * Compte de résultat simplifié (2033-B-SD), régime réel simplifié —
 * "A - RÉSULTAT COMPTABLE" section only (cases 209–310). Read directly
 * off the rendered form (specs/2033-sd_5394.pdf, page 2) — case numbers
 * cross-checked at high DPI where pdftotext's column layout was
 * ambiguous (the "dont export et livraisons intracommunautaires" memo
 * boxes sit in the SAME row as their main amount box; the main amount is
 * always the rightmost column, confirmed by alignment with the
 * unambiguous single-case rows below it).
 *
 * "B - RÉSULTAT FISCAL" (cases 312 onward — réintégrations/déductions
 * extra-comptables) is deliberately NOT built here — it's this regime's
 * analog of 2058-A (détermination du résultat fiscal), out of scope for
 * the same reason: genuine CGI tax judgment with no mechanical ledger
 * source, a separate pass. See CLAUDE.md.
 *
 * Operates on classes 6–7 only, identical scoping contract to
 * computeCompteResultat2052_2053.
 *
 * **775x/675x (cessions d'immobilisations) routing is a documented
 * convention, not a form-confirmed mapping**: 2033-B has no F1/G1/G2/G3-
 * equivalent split by nature (incorporelle/corporelle/financière) the
 * way 2052/2053 does — there is no dedicated line for cessions anywhere
 * in "A - RÉSULTAT COMPTABLE". Every 775x/675x sub-account routes to
 * Produits/Charges exceptionnels (290/300) uniformly, mirroring this
 * app's OWN fallback for a cession sub-account with no dedicated 2052/
 * 2053 line (7758/6758 → HD/HH) — applied here to the whole family since
 * this form offers no finer split at all. Revisit against the 2033-NOT-SD
 * notice if it's ever available; not guessed, but not form-confirmed
 * either — flagged here deliberately.
 */

const CDR_RULES: LineRule[] = [
  { code: '210', label: 'Ventes de marchandises', prefixes: ['707', '7097'], direction: 'credit' },
  {
    code: '214',
    label: 'Production vendue — Biens',
    prefixes: ['701', '702', '703', '704', '7091', '7092', '7094'],
    direction: 'credit',
  },
  {
    code: '218',
    label: 'Production vendue — Services',
    prefixes: ['705', '706', '7095', '7096'],
    direction: 'credit',
  },
  {
    code: '222',
    label: 'Production stockée',
    prefixes: ['71'],
    direction: 'credit',
    allowNegative: true,
  },
  { code: '224', label: 'Production immobilisée', prefixes: ['72'], direction: 'credit' },
  {
    code: '226',
    label: "Subventions d'exploitations reçues",
    prefixes: ['74'],
    direction: 'credit',
  },
  {
    code: '230',
    label: 'Autres produits',
    // Catch-all: bilan-2052's FP (781 reprises), F1 (7751/7752 cessions
    // incorp./corp.), and FQ (75/708/7098) all collapse into this one
    // line — this form has no reprises/cessions-d'immobilisations line
    // within produits d'exploitation.
    prefixes: ['781', '7751', '7752', '75', '708', '7098'],
    direction: 'credit',
  },

  { code: '234', label: 'Achats de marchandises', prefixes: ['607', '6097'], direction: 'debit' },
  {
    code: '236',
    label: 'Variation de stocks (marchandises)',
    prefixes: ['6037'],
    direction: 'debit',
    allowNegative: true,
  },
  {
    code: '238',
    label: 'Achats de matières premières et autres approvisionnements',
    prefixes: ['601', '602', '6091', '6092'],
    direction: 'debit',
  },
  {
    code: '240',
    label: 'Variation de stock (matières premières et approvisionnements)',
    prefixes: ['6031', '6032'],
    direction: 'debit',
    allowNegative: true,
  },
  {
    code: '242',
    label: 'Autres charges externes',
    prefixes: ['604', '605', '606', '61', '62', '6094', '6095', '6096'],
    direction: 'debit',
  },
  {
    code: '244',
    label: 'Impôts, taxes et versements assimilés',
    prefixes: ['63'],
    direction: 'debit',
  },
  {
    code: '250',
    label: 'Rémunérations du personnel',
    prefixes: ['641', '644'],
    direction: 'debit',
  },
  {
    code: '252',
    label: 'Cotisations sociales',
    prefixes: ['645', '646', '647', '648'],
    direction: 'debit',
  },
  {
    code: '254',
    label: 'Dotations aux amortissements',
    prefixes: ['6811'],
    direction: 'debit',
  },
  {
    code: '256',
    label: 'Dotations aux dépréciations',
    // Collapses 2052's GB (immobilisations)/GC (actif circulant)/GD
    // (risques et charges) into one line — no split on this form.
    prefixes: ['6815', '6816', '6817'],
    direction: 'debit',
  },
  {
    code: '262',
    label: 'Autres charges',
    // Catch-all mirroring 230 above: 2052's G1 (6751/6752 cessions) and
    // GE (651/653/654/658), plus 691 (participation des salariés — no
    // dedicated line on this form either) fold in here.
    prefixes: ['6751', '6752', '651', '653', '654', '658', '691'],
    direction: 'debit',
  },

  {
    code: '280',
    label: 'Produits financiers',
    // Every 2052 produits-financiers line (GJ/GK/GL/GM/GO/G2) collapses
    // into this single case — no sub-split on this form.
    prefixes: ['761', '762', '763', '764', '768', '786', '767', '7756'],
    direction: 'credit',
  },
  {
    code: '294',
    label: 'Charges financières',
    prefixes: ['661', '664', '666', '667', '668', '686', '6756'],
    direction: 'debit',
  },
  {
    code: '290',
    label: 'Produits exceptionnels',
    prefixes: ['771', '774', '7758', '778'],
    direction: 'credit',
  },
  {
    code: '300',
    label: 'Charges exceptionnelles',
    prefixes: ['671', '672', '674', '6758', '678'],
    direction: 'debit',
  },
  { code: '306', label: 'Impôt sur les bénéfices', prefixes: ['695'], direction: 'debit' },
];

export interface CompteResultat2033BLigne {
  code: string;
  label: string;
  montant: string;
}

export interface CompteResultat2033B {
  /** Every CDR_RULES line, form order — the itemized figures behind the totals below. */
  lignes: CompteResultat2033BLigne[];
  /** 232 — Total des produits d'exploitation hors TVA (I). */
  totalProduitsExploitation: string;
  /** 264 — Total des charges d'exploitation (II). */
  totalChargesExploitation: string;
  /** 270 — Résultat d'exploitation (I − II). */
  resultatExploitation: string;
  /** 280 — Produits financiers (III). */
  produitsFinanciers: string;
  /** 294 — Charges financières (V). */
  chargesFinancieres: string;
  /** 290 — Produits exceptionnels (IV). */
  produitsExceptionnels: string;
  /** 300 — Charges exceptionnelles (VI). */
  chargesExceptionnelles: string;
  /** 306 — Impôt sur les bénéfices (VII). */
  impotSurLesBenefices: string;
  /** 310 — Bénéfices ou pertes : Produits (I+III+IV) − Charges (II+V+VI+VII). Feeds bilan-2033-a's 136 — see computeBilan2033A's doc comment. */
  beneficeOuPerte: string;
}

/**
 * Pure computation, no I/O. Returns 310 (`beneficeOuPerte`), which the
 * caller must pass into computeBilan2033A — same load-bearing ordering
 * as computeCompteResultat2052_2053 → computeBilan2050.
 */
export function computeCompteResultat2033B(accounts: TrialBalanceAccount[]): CompteResultat2033B {
  const totals = classifyAccounts(accounts, CDR_RULES);
  const get = (code: string) => totals.get(code) ?? Money.zero();

  const totalProduitsExploitation = ['210', '214', '218', '222', '224', '226', '230'].reduce(
    (sum, code) => sum.plus(get(code)),
    Money.zero(),
  );
  const totalChargesExploitation = [
    '234',
    '236',
    '238',
    '240',
    '242',
    '244',
    '250',
    '252',
    '254',
    '256',
    '262',
  ].reduce((sum, code) => sum.plus(get(code)), Money.zero());
  const resultatExploitation = totalProduitsExploitation.minus(totalChargesExploitation);

  const produitsFinanciers = get('280');
  const chargesFinancieres = get('294');
  const produitsExceptionnels = get('290');
  const chargesExceptionnelles = get('300');
  const impotSurLesBenefices = get('306');

  // 310 = Produits (I + III + IV) - Charges (II + V + VI + VII), verbatim the form's own formula.
  const totalProduits = totalProduitsExploitation
    .plus(produitsFinanciers)
    .plus(produitsExceptionnels);
  const totalCharges = totalChargesExploitation
    .plus(chargesFinancieres)
    .plus(chargesExceptionnelles)
    .plus(impotSurLesBenefices);
  const beneficeOuPerte = totalProduits.minus(totalCharges);

  return {
    lignes: CDR_RULES.map((rule) => ({
      code: rule.code,
      label: rule.label,
      montant: get(rule.code).toApiString(),
    })),
    totalProduitsExploitation: totalProduitsExploitation.toApiString(),
    totalChargesExploitation: totalChargesExploitation.toApiString(),
    resultatExploitation: resultatExploitation.toApiString(),
    produitsFinanciers: produitsFinanciers.toApiString(),
    chargesFinancieres: chargesFinancieres.toApiString(),
    produitsExceptionnels: produitsExceptionnels.toApiString(),
    chargesExceptionnelles: chargesExceptionnelles.toApiString(),
    impotSurLesBenefices: impotSurLesBenefices.toApiString(),
    beneficeOuPerte: beneficeOuPerte.toApiString(),
  };
}

import { Money } from '../../common/decimal';
import { TrialBalanceAccount } from './trial-balance-engine';
import { LineRule, classifyAccounts } from './liasse-line-rules';

/**
 * Compte de résultat (2052/2053), régime réel normal — see
 * specs/liasse-2050-implementation-spec.md §2/§3/§4. Operates on classes
 * 6–7 only — the caller must exclude classes 1–5 and 8 from the trial
 * balance passed in.
 *
 * Total column only — France/Export split (FA/FB, FD/FE, FG/FH, and the
 * FJ/FK totals) is not implemented, same scoping decision already made
 * for CA3 (no AIC/imports split).
 *
 * "Opérations en commun" (GH/GI, the 655/755 account family) is
 * deliberately unmapped — see spec §4.5. If a company's ledger actually
 * uses those accounts, classifyAccounts's "unmapped account" guard
 * refuses to compute rather than silently reporting a wrong result; GH
 * and GI are always null in the output to make that explicit rather than
 * implying "computed as zero".
 */

const CDR_RULES: LineRule[] = [
  { code: 'FC', label: 'Ventes de marchandises', prefixes: ['707', '7097'], direction: 'credit' },
  {
    code: 'FF',
    label: 'Production vendue — Biens',
    prefixes: ['701', '702', '703', '704', '7091', '7092', '7094'],
    direction: 'credit',
  },
  {
    code: 'FI',
    label: 'Production vendue — Services',
    prefixes: ['705', '706', '7095', '7096'],
    direction: 'credit',
  },
  {
    code: 'FM',
    label: 'Production stockée',
    prefixes: ['71'],
    direction: 'credit',
    allowNegative: true,
  },
  { code: 'FN', label: 'Production immobilisée', prefixes: ['72'], direction: 'credit' },
  { code: 'FO', label: "Subventions d'exploitation", prefixes: ['74'], direction: 'credit' },
  {
    code: 'FP',
    label: 'Reprises sur amortissements et provisions',
    prefixes: ['781'],
    direction: 'credit',
  },
  {
    code: 'F1',
    label: "Produits des cessions d'immobilisations incorporelles et corporelles",
    prefixes: ['7751', '7752'],
    direction: 'credit',
  },
  { code: 'FQ', label: 'Autres produits', prefixes: ['75', '708', '7098'], direction: 'credit' },

  { code: 'FS', label: 'Achats de marchandises', prefixes: ['607', '6097'], direction: 'debit' },
  {
    code: 'FT',
    label: 'Variation de stocks (marchandises)',
    prefixes: ['6037'],
    direction: 'debit',
    allowNegative: true,
  },
  {
    code: 'FU',
    label: 'Achats de matières premières et autres approvisionnements',
    prefixes: ['601', '602', '6091', '6092'],
    direction: 'debit',
  },
  {
    code: 'FV',
    label: 'Variation de stocks (matières premières et approvisionnements)',
    prefixes: ['6031', '6032'],
    direction: 'debit',
    allowNegative: true,
  },
  {
    code: 'FW',
    label: 'Autres achats et charges externes',
    prefixes: ['604', '605', '606', '61', '62', '6094', '6095', '6096'],
    direction: 'debit',
  },
  {
    code: 'FX',
    label: 'Impôts, taxes et versements assimilés',
    prefixes: ['63'],
    direction: 'debit',
  },
  { code: 'FY', label: 'Salaires et traitements', prefixes: ['641', '644'], direction: 'debit' },
  {
    code: 'FZ',
    label: 'Cotisations sociales',
    prefixes: ['645', '646', '647', '648'],
    direction: 'debit',
  },
  { code: 'GA', label: 'Dotations aux amortissements', prefixes: ['6811'], direction: 'debit' },
  {
    code: 'GB',
    label: 'Dotations aux dépréciations (immobilisations)',
    prefixes: ['6816'],
    direction: 'debit',
  },
  {
    code: 'GC',
    label: 'Dotations aux dépréciations (actif circulant)',
    prefixes: ['6817'],
    direction: 'debit',
  },
  {
    code: 'GD',
    label: 'Dotations aux provisions (risques et charges)',
    prefixes: ['6815'],
    direction: 'debit',
  },
  {
    code: 'G1',
    label: 'Valeurs comptables des immobilisations incorporelles et corporelles cédées',
    prefixes: ['6751', '6752'],
    direction: 'debit',
  },
  {
    code: 'GE',
    label: 'Autres charges',
    prefixes: ['651', '653', '654', '658'],
    direction: 'debit',
  },

  {
    code: 'GJ',
    label: 'Produits financiers de participations',
    prefixes: ['761'],
    direction: 'credit',
  },
  {
    code: 'GK',
    label: "Produits des autres valeurs mobilières et créances de l'actif immobilisé",
    prefixes: ['762', '763'],
    direction: 'credit',
  },
  {
    // 764 "Revenus des valeurs mobilières de placement" was missing from the originally-approved
    // mapping — VMP (class 50) are short-term/trading investments, not "de l'actif immobilisé"
    // (that's GK's territory: 762/763, immobilized securities), so 764 belongs in GL's catch-all,
    // not GK. Found and fixed while building the oracle dataset below.
    code: 'GL',
    label: 'Autres intérêts et produits assimilés',
    prefixes: ['764', '768'],
    direction: 'credit',
  },
  {
    code: 'GM',
    label: 'Reprises sur dépréciations (financières)',
    prefixes: ['786'],
    direction: 'credit',
  },
  { code: 'GN', label: 'Différences positives de change', prefixes: ['766'], direction: 'credit' },
  {
    code: 'GO',
    label: 'Produits nets sur cessions de valeurs mobilières de placement',
    prefixes: ['767'],
    direction: 'credit',
  },
  {
    code: 'G2',
    label: "Produits des cessions d'immobilisations financières",
    prefixes: ['7756'],
    direction: 'credit',
  },

  {
    code: 'GQ',
    label: 'Dotations financières aux amortissements et provisions',
    prefixes: ['686'],
    direction: 'debit',
  },
  {
    code: 'GR',
    label: 'Intérêts et charges assimilées',
    prefixes: ['661', '664', '668'],
    direction: 'debit',
  },
  { code: 'GS', label: 'Différences négatives de change', prefixes: ['666'], direction: 'debit' },
  {
    code: 'G3',
    label: 'Valeurs comptables des immobilisations financières cédées',
    prefixes: ['6756'],
    direction: 'debit',
  },
  {
    code: 'GT',
    label: 'Charges nettes sur cessions de valeurs mobilières de placement',
    prefixes: ['667'],
    direction: 'debit',
  },

  {
    code: 'HD',
    label: 'Produits exceptionnels',
    prefixes: ['771', '774', '7758', '778'],
    direction: 'credit',
  },
  {
    code: 'HH',
    label: 'Charges exceptionnelles',
    prefixes: ['671', '672', '674', '6758', '678'],
    direction: 'debit',
  },
  {
    code: 'HJ',
    label: 'Participation des salariés aux résultats',
    prefixes: ['691'],
    direction: 'debit',
  },
  { code: 'HK', label: 'Impôts sur les bénéfices', prefixes: ['695'], direction: 'debit' },
];

export interface CompteResultat2052_2053 {
  /** FR — total des produits d'exploitation (I). */
  totalProduitsExploitation: string;
  /** GF — total des charges d'exploitation (II). */
  totalChargesExploitation: string;
  /** GG — résultat d'exploitation (I − II). */
  resultatExploitation: string;
  /** GH — bénéfice attribué ou perte transférée (III). Always null — opérations en commun deferred, see module doc comment. */
  beneficeAttribueOuPerteTransferee: null;
  /** GI — perte supportée ou bénéfice transféré (IV). Always null, same reason. */
  perteSupporteeOuBeneficeTransfere: null;
  /** GP — total des produits financiers (V). */
  totalProduitsFinanciers: string;
  /** GU — total des charges financières (VI). */
  totalChargesFinancieres: string;
  /** GV — résultat financier (V − VI). */
  resultatFinancier: string;
  /** GW — résultat courant avant impôts (I − II + III − IV + V − VI). */
  resultatCourantAvantImpots: string;
  /** HI — résultat exceptionnel (VII − VIII). */
  resultatExceptionnel: string;
  /** HL — total des produits (I + III + V + VII). */
  totalProduits: string;
  /** HM — total des charges (II + IV + VI + VIII + IX + X). */
  totalCharges: string;
  /** HN — bénéfice ou perte (total des produits − total des charges). Feeds bilan-2050's DI — see spec §5.2. */
  beneficeOuPerte: string;
}

/**
 * Pure computation, no I/O. Returns HN (`beneficeOuPerte`), which the
 * caller must pass into computeBilan2050 — see that function's doc
 * comment for why the ordering is load-bearing, not incidental.
 */
export function computeCompteResultat2052_2053(
  accounts: TrialBalanceAccount[],
): CompteResultat2052_2053 {
  const totals = classifyAccounts(accounts, CDR_RULES);
  const get = (code: string) => totals.get(code) ?? Money.zero();

  const totalProduitsExploitation = ['FC', 'FF', 'FI', 'FM', 'FN', 'FO', 'FP', 'F1', 'FQ'].reduce(
    (sum, code) => sum.plus(get(code)),
    Money.zero(),
  );
  const totalChargesExploitation = [
    'FS',
    'FT',
    'FU',
    'FV',
    'FW',
    'FX',
    'FY',
    'FZ',
    'GA',
    'GB',
    'GC',
    'GD',
    'G1',
    'GE',
  ].reduce((sum, code) => sum.plus(get(code)), Money.zero());
  const resultatExploitation = totalProduitsExploitation.minus(totalChargesExploitation);

  // GH/GI (opérations en commun) deferred — treated as zero in the formulas below. A company that
  // actually has such activity would already have been refused by classifyAccounts's unmapped-account
  // guard before reaching this point, so this zero is never silently wrong — see module doc comment.
  const beneficeAttribueOuPerteTransferee = Money.zero();
  const perteSupporteeOuBeneficeTransfere = Money.zero();

  const totalProduitsFinanciers = ['GJ', 'GK', 'GL', 'GM', 'GN', 'GO', 'G2'].reduce(
    (sum, code) => sum.plus(get(code)),
    Money.zero(),
  );
  const totalChargesFinancieres = ['GQ', 'GR', 'GS', 'G3', 'GT'].reduce(
    (sum, code) => sum.plus(get(code)),
    Money.zero(),
  );
  const resultatFinancier = totalProduitsFinanciers.minus(totalChargesFinancieres);

  // GW = I - II + III - IV + V - VI = GG + beneficeAttribue(III) - perteSupportee(IV) + GV.
  const resultatCourantAvantImpots = resultatExploitation
    .plus(beneficeAttribueOuPerteTransferee)
    .minus(perteSupporteeOuBeneficeTransfere)
    .plus(resultatFinancier);

  const produitsExceptionnels = get('HD');
  const chargesExceptionnelles = get('HH');
  const resultatExceptionnel = produitsExceptionnels.minus(chargesExceptionnelles);

  const participationSalaries = get('HJ');
  const impotsSurLesBenefices = get('HK');

  const totalProduits = totalProduitsExploitation
    .plus(beneficeAttribueOuPerteTransferee)
    .plus(totalProduitsFinanciers)
    .plus(produitsExceptionnels);
  const totalCharges = totalChargesExploitation
    .plus(perteSupporteeOuBeneficeTransfere)
    .plus(totalChargesFinancieres)
    .plus(chargesExceptionnelles)
    .plus(participationSalaries)
    .plus(impotsSurLesBenefices);
  const beneficeOuPerte = totalProduits.minus(totalCharges);

  return {
    totalProduitsExploitation: totalProduitsExploitation.toApiString(),
    totalChargesExploitation: totalChargesExploitation.toApiString(),
    resultatExploitation: resultatExploitation.toApiString(),
    beneficeAttribueOuPerteTransferee: null,
    perteSupporteeOuBeneficeTransfere: null,
    totalProduitsFinanciers: totalProduitsFinanciers.toApiString(),
    totalChargesFinancieres: totalChargesFinancieres.toApiString(),
    resultatFinancier: resultatFinancier.toApiString(),
    resultatCourantAvantImpots: resultatCourantAvantImpots.toApiString(),
    resultatExceptionnel: resultatExceptionnel.toApiString(),
    totalProduits: totalProduits.toApiString(),
    totalCharges: totalCharges.toApiString(),
    beneficeOuPerte: beneficeOuPerte.toApiString(),
  };
}

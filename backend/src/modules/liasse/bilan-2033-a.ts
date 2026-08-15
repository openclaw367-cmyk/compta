import { Money } from '../../common/decimal';
import { TrialBalanceAccount } from './trial-balance-engine';
import { DualNatureRule, LineRule, classifyAccounts } from './liasse-line-rules';

/**
 * Bilan simplifié (2033-A-SD), régime réel simplifié — the coarser,
 * second-regime analog of bilan-2050.ts, built the same way: primary
 * source read directly off the rendered CERFA form (specs/2033-sd_5394.pdf,
 * page 1 — pdftotext's own column heuristics disagreed with each other on
 * the DETTES section's case-number ordering, so every case number below
 * was cross-checked against a rendered image of the form, not text
 * extraction alone). Case numbers and labels are quoted verbatim.
 *
 * This form has far fewer lines than 2050/2051 — many of bilan-2050's
 * distinct lines (e.g. AB/CX/AF/AJ/AL, or CS/CU/BB/BD/BF/BH) collapse
 * into ONE 2033-A line each ("Autres" incorporelles, "Immobilisations
 * financières"). Where an account has no line of its own on this
 * simplified form, it's folded into the nearest documented catch-all —
 * same "no dedicated line → route to nearest catch-all, flagged in a
 * comment" convention bilan-2050.ts already uses for 206→AJ, 1062→DG.
 *
 * Operates on classes 1–5 only, identical scoping contract to
 * computeBilan2050 — the caller excludes classes 6–8 from the trial
 * balance passed in.
 */

const DEDUCTIBLE_IMMOBILISATIONS_ACCOUNT = '445662';
const DEDUCTIBLE_AUTRES_ACCOUNT = '445660';
const TVA_COLLECTEE_ACCOUNT = '445710';

const ACTIF_RULES: LineRule[] = [
  { code: '010', label: 'Fonds commercial (brut)', prefixes: ['207'], direction: 'debit' },
  { code: '012', label: 'Fonds commercial (amort.)', prefixes: ['2807'], direction: 'credit' },
  {
    code: '014',
    label: 'Autres immobilisations incorporelles (brut)',
    // Rolls up every 2050-series incorporelle line (AB/CX/AF/AJ/AL) except
    // Fonds commercial (207, its own 010/012 line above) — this form has
    // no dedicated line for frais d'établissement/développement/
    // concessions-brevets/droit au bail/en cours individually.
    prefixes: ['201', '203', '205', '206', '208', '232', '237'],
    direction: 'debit',
  },
  {
    code: '016',
    label: 'Autres immobilisations incorporelles (amort.)',
    prefixes: ['2801', '2803', '2805', '2806', '2808', '2932'],
    direction: 'credit',
  },
  {
    code: '028',
    label: 'Immobilisations corporelles (brut)',
    // Rolls up bilan-2050's AN/AP/AR/AT/AV — no terrains/constructions/
    // installations-techniques split on this form.
    prefixes: ['211', '212', '213', '214', '215', '218', '231', '238'],
    direction: 'debit',
  },
  {
    code: '030',
    label: 'Immobilisations corporelles (amort.)',
    prefixes: ['2811', '2911', '2812', '2813', '2814', '2815', '2818', '2931'],
    direction: 'credit',
  },
  {
    code: '040',
    label: 'Immobilisations financières (brut)',
    // Rolls up bilan-2050's CS/CU/BB/BD/BF/BH — no participations/TIAP/
    // créances-rattachées/prêts split.
    prefixes: ['25', '261', '266', '267', '271', '272', '273', '274', '275', '276', '277'],
    direction: 'debit',
  },
  {
    code: '042',
    label: 'Immobilisations financières (dépréc.)',
    prefixes: ['2961', '2966', '2967', '2971', '2972', '2973', '2974', '2975', '2976'],
    direction: 'credit',
  },
  {
    code: '050',
    label: 'Matières premières, approvisionnements, en cours de production (brut)',
    // Rolls up bilan-2050's BL/BN/BP/BR — matières premières AND en-cours
    // (biens/services) share one line on this form, unlike 2050's split.
    prefixes: ['31', '32', '33', '34', '35'],
    direction: 'debit',
  },
  {
    code: '052',
    label: 'Matières premières, approvisionnements, en cours de production (dépréc.)',
    prefixes: ['391', '392', '393', '394', '395'],
    direction: 'credit',
  },
  { code: '060', label: 'Marchandises (brut)', prefixes: ['37'], direction: 'debit' },
  { code: '062', label: 'Marchandises (dépréc.)', prefixes: ['397'], direction: 'credit' },
  {
    code: '064',
    label: 'Avances et acomptes versés sur commandes',
    prefixes: ['409'],
    direction: 'debit',
  },
  {
    code: '068',
    label: 'Clients et comptes rattachés (brut)',
    prefixes: ['411', '413', '416', '418'],
    direction: 'debit',
  },
  {
    code: '070',
    label: 'Clients et comptes rattachés (dépréc.)',
    prefixes: ['491'],
    direction: 'credit',
  },
  {
    code: '072',
    label: 'Autres créances (brut)',
    prefixes: [
      '425',
      '441',
      '442',
      '443',
      DEDUCTIBLE_IMMOBILISATIONS_ACCOUNT,
      DEDUCTIBLE_AUTRES_ACCOUNT,
      '462',
      '465',
    ],
    direction: 'debit',
  },
  {
    code: '074',
    label: 'Autres créances (dépréc.)',
    prefixes: ['495', '496'],
    direction: 'credit',
  },
  {
    code: '092',
    label: "Charges constatées d'avance",
    prefixes: ['486'],
    direction: 'debit',
  },
  {
    code: '080',
    label: 'Valeurs mobilières de placement (brut)',
    prefixes: ['50'],
    direction: 'debit',
  },
  {
    code: '082',
    label: 'Valeurs mobilières de placement (dépréc.)',
    prefixes: ['590'],
    direction: 'credit',
  },
  {
    code: '084',
    label: 'Disponibilités',
    // 512/514/516/517 (banks) are dual-nature — see DUAL_NATURE_RULES
    // below, same overdraft-sign-reclassification confirmed for
    // bilan-2050's CF/DU pair.
    prefixes: ['511', '53', '54', '58'],
    direction: 'debit',
  },
];

const PASSIF_RULES: LineRule[] = [
  { code: '120', label: 'Capital social ou individuel', prefixes: ['101'], direction: 'credit' },
  { code: '124', label: 'Écarts de réévaluation', prefixes: ['105', '107'], direction: 'credit' },
  { code: '126', label: 'Réserve légale', prefixes: ['1061'], direction: 'credit' },
  { code: '130', label: 'Réserves réglementées', prefixes: ['1064'], direction: 'credit' },
  {
    code: '132',
    label: 'Autres réserves',
    // 104 "Primes liées au capital social" has no dedicated line on this
    // form (2033-A has no "primes d'émission" line the way 2050/2051
    // does with DB) — folded here, same "no dedicated line" convention.
    // 1062/1063/1068 also fold in — 2050 splits DE (1063, statutaires)
    // from DG (1062/1068, autres); this form has only one "Autres
    // réserves" line for all three.
    prefixes: ['104', '1062', '1063', '1068'],
    direction: 'credit',
  },
  {
    code: '134',
    label: 'Report à nouveau',
    prefixes: ['110', '119'],
    direction: 'credit',
    allowNegative: true,
  },
  // 136 "Résultat de l'exercice" is NOT a LineRule — like bilan-2050's DI,
  // it's never a ledger read (see computeBilan2033A's doc comment).
  {
    code: '137',
    label: "Subventions d'investissement",
    prefixes: ['13'],
    direction: 'credit',
  },
  { code: '140', label: 'Provisions réglementées', prefixes: ['14'], direction: 'credit' },
  {
    code: '154',
    label: 'Provisions pour risques et charges',
    prefixes: ['15'],
    direction: 'credit',
  },
  {
    code: '156',
    label: 'Emprunts et dettes assimilées',
    // Rolls up bilan-2050's DS/DT/DU/DV — no obligataires-convertibles/
    // établissements-de-crédit/divers split. 519 (concours bancaires,
    // always a liability) belongs here directly, same as bilan-2050's DU.
    prefixes: ['161', '162', '163', '164', '165', '166', '168', '519'],
    direction: 'credit',
  },
  {
    code: '164',
    label: 'Avances et acomptes reçus sur commandes en cours',
    prefixes: ['419'],
    direction: 'credit',
  },
  {
    code: '166',
    label: 'Fournisseurs et comptes rattachés',
    // Includes 404/405 (fournisseurs d'immobilisations) — this form has
    // no dedicated "dettes sur immobilisations" line the way bilan-2050
    // does with DZ; 404/405 are still PCG class-40 "fournisseurs" family
    // accounts, so they fold into this line rather than "Autres dettes"
    // (175), which is reserved for the non-fournisseur residual (451/464).
    prefixes: ['401', '403', '404', '405', '408'],
    direction: 'credit',
  },
  {
    code: '172',
    label: 'Dettes fiscales et sociales',
    prefixes: ['421', '427', '431', '437', '444', TVA_COLLECTEE_ACCOUNT, '4455', '446', '447'],
    direction: 'credit',
  },
  // 173 "Comptes courants d'associés" — unlike bilan-2050 (which folds 455
  // into EA alongside 451/464/458/467/468), this form gives associés
  // comptes courants their OWN line — see DUAL_NATURE_RULES below.
  {
    code: '175',
    label: 'Autres dettes',
    prefixes: ['451', '464'],
    direction: 'credit',
  },
  {
    code: '174',
    label: "Produits constatés d'avance",
    prefixes: ['487'],
    direction: 'credit',
  },
];

/**
 * Same overdraft/personnel/associés-divers dual-nature routing as
 * bilan-2050.ts's DUAL_NATURE_RULES, retargeted to this form's coarser
 * line codes. 455 (associés comptes courants) gets its own dedicated
 * PASSIF line (173) unlike bilan-2050, where it shares EA with
 * 451/464/458/467/468 — this form is MORE granular than 2050 for this
 * one family, not less.
 */
const DUAL_NATURE_RULES: DualNatureRule[] = [
  { prefixes: ['512', '514', '516', '517'], debitLine: '084', creditLine: '156' },
  { prefixes: ['455'], debitLine: '072', creditLine: '173' },
  { prefixes: ['428', '438', '448'], debitLine: '072', creditLine: '172' },
  { prefixes: ['458', '467', '468'], debitLine: '072', creditLine: '175' },
];

export interface Bilan2033AActifLigne {
  code: string;
  label: string;
  brut: string;
  amortissements: string;
  net: string;
}

export interface Bilan2033APassifLigne {
  code: string;
  label: string;
  montant: string;
}

export interface Bilan2033A {
  actif: Bilan2033AActifLigne[];
  /** 044/048 — Total I (Actif immobilisé), colonnes Brut/Amortissements. */
  totalIActifBrut: string;
  totalIActifAmortissements: string;
  /** 096/098 — Total II (Actif circulant), colonnes Brut/Amortissements. */
  totalIIActifBrut: string;
  totalIIActifAmortissements: string;
  /** 110/112 — Total général (I + II), colonnes Brut/Amortissements. */
  totalActifBrut: string;
  totalActifAmortissements: string;
  /** Net = Brut − Amortissements, uncoded on the form itself (same convention as bilan-2050's totalActifNet). */
  totalActifNet: string;
  /** Includes 134 (Report à nouveau — may legitimately be negative). 136 is not in this array — see resultatDeLExercice. */
  passif: Bilan2033APassifLigne[];
  /** 142 — Total I (Capitaux propres) — EXCLUDES 136 (Résultat), which the form places inside Total I but this app derives separately (see resultatDeLExercice). Callers needing the form's own Total I must add resultatDeLExercice to this. */
  totalIPassifExcludingResultat: string;
  /** 136 — Résultat de l'exercice. Not a ledger read — set to the value passed in, same convention as bilan-2050's DI (see spec). */
  resultatDeLExercice: string;
  /** 154 — Total II (Provisions pour risques et charges). */
  totalIIPassif: string;
  /** 176 — Total III (Dettes). */
  totalIIIPassif: string;
  /** 180 — Total général (I + II + III). */
  totalPassif: string;
}

const ACTIF_ROWS: { code: string; brutCode: string; amortCode: string; label: string }[] = [
  { code: '010', brutCode: '010', amortCode: '012', label: 'Fonds commercial' },
  { code: '014', brutCode: '014', amortCode: '016', label: 'Autres immobilisations incorporelles' },
  { code: '028', brutCode: '028', amortCode: '030', label: 'Immobilisations corporelles' },
  { code: '040', brutCode: '040', amortCode: '042', label: 'Immobilisations financières' },
  {
    code: '050',
    brutCode: '050',
    amortCode: '052',
    label: 'Matières premières, approvisionnements, en cours de production',
  },
  { code: '060', brutCode: '060', amortCode: '062', label: 'Marchandises' },
  {
    code: '064',
    brutCode: '064',
    amortCode: '066',
    label: 'Avances et acomptes versés sur commandes',
  },
  { code: '068', brutCode: '068', amortCode: '070', label: 'Clients et comptes rattachés' },
  { code: '072', brutCode: '072', amortCode: '074', label: 'Autres créances' },
  { code: '092', brutCode: '092', amortCode: '094', label: "Charges constatées d'avance" },
  { code: '080', brutCode: '080', amortCode: '082', label: 'Valeurs mobilières de placement' },
  { code: '084', brutCode: '084', amortCode: '086', label: 'Disponibilités' },
];

const ACTIF_I_CODES = ['010', '014', '028', '040'];
const ACTIF_II_CODES = ['050', '060', '064', '068', '072', '092', '080', '084'];

const PASSIF_ROWS: { code: string; label: string }[] = [
  { code: '120', label: 'Capital social ou individuel' },
  { code: '124', label: 'Écarts de réévaluation' },
  { code: '126', label: 'Réserve légale' },
  { code: '130', label: 'Réserves réglementées' },
  { code: '132', label: 'Autres réserves' },
  { code: '134', label: 'Report à nouveau' },
  { code: '137', label: "Subventions d'investissement" },
  { code: '140', label: 'Provisions réglementées' },
];
const PASSIF_I_CODES = PASSIF_ROWS.map((r) => r.code);

const DETTES_ROWS: { code: string; label: string }[] = [
  { code: '156', label: 'Emprunts et dettes assimilées' },
  { code: '164', label: 'Avances et acomptes reçus sur commandes en cours' },
  { code: '166', label: 'Fournisseurs et comptes rattachés' },
  { code: '172', label: 'Dettes fiscales et sociales' },
  { code: '173', label: "Comptes courants d'associés" },
  { code: '175', label: 'Autres dettes' },
  { code: '174', label: "Produits constatés d'avance" },
];
const DETTES_CODES = DETTES_ROWS.map((r) => r.code);

/**
 * Pure computation. `resultatDeLExercice` must be
 * computeCompteResultat2033B's `beneficeOuPerte` (ligne 310) — same
 * load-bearing compute-order requirement as computeBilan2050, and for
 * the same reason: account 120/129 reads 0.00 within the fiscal year
 * itself (a-nouveau.service.ts only posts a year's result into 120/129
 * as part of the FOLLOWING year's opening écriture).
 */
export function computeBilan2033A(
  accounts: TrialBalanceAccount[],
  resultatDeLExercice: Money,
): Bilan2033A {
  const totals = classifyAccounts(accounts, [...ACTIF_RULES, ...PASSIF_RULES], DUAL_NATURE_RULES);

  const actif: Bilan2033AActifLigne[] = ACTIF_ROWS.map((row) => {
    const brut = totals.get(row.brutCode) ?? Money.zero();
    const amort = totals.get(row.amortCode) ?? Money.zero();
    return {
      code: row.code,
      label: row.label,
      brut: brut.toApiString(),
      amortissements: amort.toApiString(),
      net: brut.minus(amort).toApiString(),
    };
  });

  const sumCodes = (codes: string[], suffix: 'brutCode' | 'amortCode') =>
    ACTIF_ROWS.filter((r) => codes.includes(r.code)).reduce(
      (sum, row) => sum.plus(totals.get(row[suffix]) ?? Money.zero()),
      Money.zero(),
    );

  const totalIActifBrut = sumCodes(ACTIF_I_CODES, 'brutCode');
  const totalIActifAmortissements = sumCodes(ACTIF_I_CODES, 'amortCode');
  const totalIIActifBrut = sumCodes(ACTIF_II_CODES, 'brutCode');
  const totalIIActifAmortissements = sumCodes(ACTIF_II_CODES, 'amortCode');
  const totalActifBrut = totalIActifBrut.plus(totalIIActifBrut);
  const totalActifAmortissements = totalIActifAmortissements.plus(totalIIActifAmortissements);

  const passif: Bilan2033APassifLigne[] = PASSIF_ROWS.map((row) => ({
    code: row.code,
    label: row.label,
    montant: (totals.get(row.code) ?? Money.zero()).toApiString(),
  })).concat(
    DETTES_ROWS.map((row) => ({
      code: row.code,
      label: row.label,
      montant: (totals.get(row.code) ?? Money.zero()).toApiString(),
    })),
  );

  const totalIPassifExcludingResultat = PASSIF_I_CODES.reduce(
    (sum, code) => sum.plus(totals.get(code) ?? Money.zero()),
    Money.zero(),
  );
  const totalIIPassif = totals.get('154') ?? Money.zero();
  const totalIIIPassif = DETTES_CODES.reduce(
    (sum, code) => sum.plus(totals.get(code) ?? Money.zero()),
    Money.zero(),
  );
  const totalPassif = totalIPassifExcludingResultat
    .plus(resultatDeLExercice)
    .plus(totalIIPassif)
    .plus(totalIIIPassif);

  return {
    actif,
    totalIActifBrut: totalIActifBrut.toApiString(),
    totalIActifAmortissements: totalIActifAmortissements.toApiString(),
    totalIIActifBrut: totalIIActifBrut.toApiString(),
    totalIIActifAmortissements: totalIIActifAmortissements.toApiString(),
    totalActifBrut: totalActifBrut.toApiString(),
    totalActifAmortissements: totalActifAmortissements.toApiString(),
    totalActifNet: totalActifBrut.minus(totalActifAmortissements).toApiString(),
    passif,
    totalIPassifExcludingResultat: totalIPassifExcludingResultat.toApiString(),
    resultatDeLExercice: resultatDeLExercice.toApiString(),
    totalIIPassif: totalIIPassif.toApiString(),
    totalIIIPassif: totalIIIPassif.toApiString(),
    totalPassif: totalPassif.toApiString(),
  };
}

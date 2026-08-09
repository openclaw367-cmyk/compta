import { BadRequestException, ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { TrialBalanceAccount } from './trial-balance-engine';
import { DualNatureRule, LineRule, classifyAccounts } from './liasse-line-rules';

/**
 * Bilan (2050 Actif / 2051 Passif), régime réel normal — see
 * specs/liasse-2050-implementation-spec.md §2/§3 for the quoted line
 * spec and the account mapping this implements, and §4 for what's
 * deliberately left unmapped (and will throw rather than guess).
 *
 * Operates on classes 1–5 only — the caller must exclude classes 6–8
 * from the trial balance passed in (6–7 belong to the compte de
 * résultat, 8 is off-balance-sheet and not part of either form).
 */

/** Ligne 19/20's own accounts, unambiguous, no rate/category split — reused verbatim from the VAT module's convention. */
const DEDUCTIBLE_IMMOBILISATIONS_ACCOUNT = '445662';
const DEDUCTIBLE_AUTRES_ACCOUNT = '445660';
const TVA_COLLECTEE_ACCOUNT = '445710';

/**
 * Actif rows: each has a Brut rule and (usually) a matching
 * Amortissements/dépréciations contra rule. Both are ordinary LineRules
 * in the same flat classification — a 28x/29x/39x/49x/59x contra account
 * is just another 'credit'-direction line, no special-casing needed.
 */
const ACTIF_RULES: LineRule[] = [
  { code: 'AB', label: "Frais d'établissement (brut)", prefixes: ['201'], direction: 'debit' },
  { code: 'AC', label: "Frais d'établissement (amort.)", prefixes: ['2801'], direction: 'credit' },
  { code: 'CX', label: 'Frais de développement (brut)', prefixes: ['203'], direction: 'debit' },
  { code: 'CQ', label: 'Frais de développement (amort.)', prefixes: ['2803'], direction: 'credit' },
  {
    code: 'AF',
    label: 'Concessions, brevets et droits similaires (brut)',
    prefixes: ['205'],
    direction: 'debit',
  },
  {
    code: 'AG',
    label: 'Concessions, brevets et droits similaires (amort.)',
    prefixes: ['2805'],
    direction: 'credit',
  },
  { code: 'AH', label: 'Fonds commercial (brut)', prefixes: ['207'], direction: 'debit' },
  { code: 'AI', label: 'Fonds commercial (amort.)', prefixes: ['2807'], direction: 'credit' },
  // 206 "Droit au bail" has no dedicated 2050 line — routed here, flagged (spec §4.8).
  {
    code: 'AJ',
    label: 'Autres immobilisations incorporelles (brut)',
    prefixes: ['206', '208'],
    direction: 'debit',
  },
  {
    code: 'AK',
    label: 'Autres immobilisations incorporelles (amort.)',
    prefixes: ['2806', '2808'],
    direction: 'credit',
  },
  {
    code: 'AL',
    label: 'Immobilisations incorporelles en cours, avances et acomptes (brut)',
    prefixes: ['232', '237'],
    direction: 'debit',
  },
  {
    code: 'AM',
    label: 'Immobilisations incorporelles en cours (dépréciations)',
    prefixes: ['2932'],
    direction: 'credit',
  },
  { code: 'AN', label: 'Terrains (brut)', prefixes: ['211'], direction: 'debit' },
  {
    code: 'AO',
    label: 'Terrains (amort./dépréc.)',
    prefixes: ['2811', '2911'],
    direction: 'credit',
  },
  { code: 'AP', label: 'Constructions (brut)', prefixes: ['213', '214'], direction: 'debit' },
  { code: 'AQ', label: 'Constructions (amort.)', prefixes: ['2813', '2814'], direction: 'credit' },
  {
    code: 'AR',
    label: 'Installations techniques, matériel et outillage industriels (brut)',
    prefixes: ['215'],
    direction: 'debit',
  },
  {
    code: 'AS',
    label: 'Installations techniques, matériel et outillage industriels (amort.)',
    prefixes: ['2815'],
    direction: 'credit',
  },
  {
    code: 'AT',
    label: 'Autres immobilisations corporelles (brut)',
    prefixes: ['212', '218'],
    direction: 'debit',
  },
  {
    code: 'AU',
    label: 'Autres immobilisations corporelles (amort.)',
    prefixes: ['2812', '2818'],
    direction: 'credit',
  },
  {
    code: 'AV',
    label: 'Immobilisations corporelles en cours, avances et acomptes (brut)',
    prefixes: ['231', '238'],
    direction: 'debit',
  },
  {
    code: 'AW',
    label: 'Immobilisations corporelles en cours (dépréciations)',
    prefixes: ['2931'],
    direction: 'credit',
  },
  { code: 'CS', label: 'Participations (brut)', prefixes: ['261', '266'], direction: 'debit' },
  {
    code: 'CT',
    label: 'Participations (dépréciations)',
    prefixes: ['2961', '2966'],
    direction: 'credit',
  },
  {
    code: 'CU',
    label: "Titres immobilisés de l'activité de portefeuille (brut)",
    prefixes: ['273'],
    direction: 'debit',
  },
  {
    code: 'CV',
    label: "Titres immobilisés de l'activité de portefeuille (dépréc.)",
    prefixes: ['2973'],
    direction: 'credit',
  },
  {
    code: 'BB',
    label: 'Créances rattachées à des participations (brut)',
    prefixes: ['267'],
    direction: 'debit',
  },
  {
    code: 'BC',
    label: 'Créances rattachées à des participations (dépréc.)',
    prefixes: ['2967'],
    direction: 'credit',
  },
  {
    code: 'BD',
    label: 'Autres titres immobilisés (brut)',
    prefixes: ['25', '271', '272'],
    direction: 'debit',
  },
  {
    code: 'BE',
    label: 'Autres titres immobilisés (dépréc.)',
    prefixes: ['2971', '2972'],
    direction: 'credit',
  },
  { code: 'BF', label: 'Prêts (brut)', prefixes: ['274'], direction: 'debit' },
  { code: 'BG', label: 'Prêts (dépréc.)', prefixes: ['2974'], direction: 'credit' },
  {
    code: 'BH',
    label: 'Autres immobilisations financières (brut)',
    prefixes: ['275', '276', '277'],
    direction: 'debit',
  },
  {
    code: 'BI',
    label: 'Autres immobilisations financières (dépréc.)',
    prefixes: ['2975', '2976'],
    direction: 'credit',
  },

  {
    code: 'BL',
    label: 'Matières premières, approvisionnements (brut)',
    prefixes: ['31', '32'],
    direction: 'debit',
  },
  {
    code: 'BM',
    label: 'Matières premières, approvisionnements (dépréc.)',
    prefixes: ['391', '392'],
    direction: 'credit',
  },
  {
    code: 'BN',
    label: 'En cours de production de biens (brut)',
    prefixes: ['33'],
    direction: 'debit',
  },
  {
    code: 'BO',
    label: 'En cours de production de biens (dépréc.)',
    prefixes: ['393'],
    direction: 'credit',
  },
  {
    code: 'BP',
    label: 'En cours de production de services (brut)',
    prefixes: ['34'],
    direction: 'debit',
  },
  {
    code: 'BQ',
    label: 'En cours de production de services (dépréc.)',
    prefixes: ['394'],
    direction: 'credit',
  },
  {
    code: 'BR',
    label: 'Produits intermédiaires et finis (brut)',
    prefixes: ['35'],
    direction: 'debit',
  },
  {
    code: 'BS',
    label: 'Produits intermédiaires et finis (dépréc.)',
    prefixes: ['395'],
    direction: 'credit',
  },
  { code: 'BT', label: 'Marchandises (brut)', prefixes: ['37'], direction: 'debit' },
  { code: 'BU', label: 'Marchandises (dépréc.)', prefixes: ['397'], direction: 'credit' },

  {
    code: 'BV',
    label: 'Avances et acomptes versés sur commandes (brut)',
    prefixes: ['409'],
    direction: 'debit',
  },
  {
    code: 'BX',
    label: 'Clients et comptes rattachés (brut)',
    prefixes: ['411', '413', '416', '418'],
    direction: 'debit',
  },
  {
    code: 'BY',
    label: 'Clients et comptes rattachés (dépréc.)',
    prefixes: ['491'],
    direction: 'credit',
  },
  {
    code: 'BZ',
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
  { code: 'CA', label: 'Autres créances (dépréc.)', prefixes: ['495', '496'], direction: 'credit' },
  {
    code: 'CB',
    label: 'Capital souscrit et appelé, non versé (brut)',
    prefixes: ['109'],
    direction: 'debit',
  },
  {
    code: 'CD',
    label: 'Valeurs mobilières de placement (brut)',
    prefixes: ['50'],
    direction: 'debit',
  },
  {
    code: 'CE',
    label: 'Valeurs mobilières de placement (dépréc.)',
    prefixes: ['590'],
    direction: 'credit',
  },
  { code: 'CF', label: 'Disponibilités', prefixes: ['511', '53', '54', '58'], direction: 'debit' },
  { code: 'CH', label: "Charges constatées d'avance", prefixes: ['486'], direction: 'debit' },
  { code: 'CW', label: "Frais d'émission d'emprunt", prefixes: ['481'], direction: 'debit' },
  {
    code: 'CM',
    label: 'Primes de remboursement des emprunts',
    prefixes: ['169'],
    direction: 'debit',
  },
  {
    code: 'CN',
    label: "Écarts de conversion actif et différences d'évaluation",
    prefixes: ['476'],
    direction: 'debit',
  },
];

const PASSIF_RULES: LineRule[] = [
  { code: 'DA', label: 'Capital social ou individuel', prefixes: ['101'], direction: 'credit' },
  {
    code: 'DB',
    label: "Primes d'émission, de fusion, d'apport",
    prefixes: ['104'],
    direction: 'credit',
  },
  // 107 "Écart d'équivalence" folded in — flagged, spec §4.7 (memo EK unimplemented).
  { code: 'DC', label: 'Écarts de réévaluation', prefixes: ['105', '107'], direction: 'credit' },
  { code: 'DD', label: 'Réserve légale', prefixes: ['1061'], direction: 'credit' },
  {
    code: 'DE',
    label: 'Réserves statutaires ou contractuelles',
    prefixes: ['1063'],
    direction: 'credit',
  },
  { code: 'DF', label: 'Réserves réglementées', prefixes: ['1064'], direction: 'credit' },
  // 1062 "Réserves indisponibles" has no dedicated line — routed here, same pattern as 206→AJ.
  { code: 'DG', label: 'Autres réserves', prefixes: ['1062', '1068'], direction: 'credit' },
  // 110 (crédit, report à nouveau positif) and 119 (débit, report à nouveau négatif) share this
  // line under the SAME 'credit' convention — 119's debit balance naturally contributes negatively,
  // netting correctly with no special-casing (same mechanism as a contra account). allowNegative
  // because an accumulated deficit (119 > 110) is a normal, expected outcome, not an error.
  {
    code: 'DH',
    label: 'Report à nouveau',
    prefixes: ['110', '119'],
    direction: 'credit',
    allowNegative: true,
  },
  { code: 'DJ', label: "Subventions d'investissement", prefixes: ['13'], direction: 'credit' },
  { code: 'DK', label: 'Provisions réglementées', prefixes: ['14'], direction: 'credit' },
  {
    code: 'DM',
    label: 'Produit des émissions de titres participatifs',
    prefixes: ['1671'],
    direction: 'credit',
  },
  { code: 'DN', label: 'Avances conditionnées', prefixes: ['1674'], direction: 'credit' },
  { code: 'DP', label: 'Provisions pour risques', prefixes: ['151'], direction: 'credit' },
  {
    code: 'DQ',
    label: 'Provisions pour charges',
    prefixes: ['153', '154', '155', '156', '157', '158'],
    direction: 'credit',
  },
  {
    code: 'DS',
    label: 'Emprunts obligataires convertibles',
    prefixes: ['161'],
    direction: 'credit',
  },
  {
    code: 'DT',
    label: 'Autres emprunts obligataires',
    prefixes: ['162', '163'],
    direction: 'credit',
  },
  // 519 "Concours bancaires courants" is by definition a liability, not dual-nature like 512/514/516/517.
  {
    code: 'DU',
    label: 'Emprunts et dettes auprès des établissements de crédit',
    prefixes: ['164', '165', '519'],
    direction: 'credit',
  },
  {
    code: 'DV',
    label: 'Emprunts et dettes financières divers',
    prefixes: ['166', '168'],
    direction: 'credit',
  },
  {
    code: 'DW',
    label: 'Avances et acomptes reçus sur commandes en cours',
    prefixes: ['419'],
    direction: 'credit',
  },
  {
    code: 'DX',
    label: 'Dettes fournisseurs et comptes rattachés',
    prefixes: ['401', '403', '408'],
    direction: 'credit',
  },
  {
    code: 'DY',
    label: 'Dettes fiscales et sociales',
    prefixes: ['421', '427', '431', '437', '444', TVA_COLLECTEE_ACCOUNT, '4455', '446', '447'],
    direction: 'credit',
  },
  {
    code: 'DZ',
    label: 'Dettes sur immobilisations et comptes rattachés',
    prefixes: ['404', '405'],
    direction: 'credit',
  },
  { code: 'EA', label: 'Autres dettes', prefixes: ['451', '464'], direction: 'credit' },
  { code: 'EB', label: "Produits constatés d'avance", prefixes: ['487'], direction: 'credit' },
  {
    code: 'ED',
    label: "Écart de conversion passif et différences d'évaluation",
    prefixes: ['477'],
    direction: 'credit',
  },
];

/**
 * Accounts whose bilan side depends on their own balance sign this
 * period — see specs/liasse-2050-implementation-spec.md §4.1 for the
 * bank-overdraft case (the one confirmed against the form's own EH memo
 * line) and §7's account-family notes for the others (personnel/social/
 * fiscal and associés "charges à payer / produits à recevoir" families,
 * per PCG art. 933-4's own terminaison-8 rule).
 */
const DUAL_NATURE_RULES: DualNatureRule[] = [
  { prefixes: ['512', '514', '516', '517'], debitLine: 'CF', creditLine: 'DU' },
  { prefixes: ['455'], debitLine: 'BZ', creditLine: 'EA' },
  { prefixes: ['428', '438', '448'], debitLine: 'BZ', creditLine: 'DY' },
  { prefixes: ['458', '467', '468'], debitLine: 'BZ', creditLine: 'EA' },
];

export interface BilanActifLigne {
  code: string;
  label: string;
  brut: string;
  amortissements: string;
  net: string;
}

export interface BilanPassifLigne {
  code: string;
  label: string;
  montant: string;
}

export interface Bilan2050 {
  actif: BilanActifLigne[];
  /** CO — Actif total, colonne Brut. */
  totalActifBrut: string;
  /** 1A — Actif total, colonne Amortissements/provisions. */
  totalActifAmortissements: string;
  /** CO − 1A, uncoded on the form itself — see spec §2. */
  totalActifNet: string;
  /** Includes DH (Report à nouveau — may legitimately be negative). DI is not in this array — see resultatDeLExercice. */
  passif: BilanPassifLigne[];
  /** DI — Résultat de l'exercice. Not a ledger read — set to the value passed in (see spec §5.2). */
  resultatDeLExercice: string;
  /** EE — Passif total. */
  totalPassif: string;
}

const ACTIF_ROWS: { code: string; brutCode: string; amortCode: string; label: string }[] = [
  { code: 'AB', brutCode: 'AB', amortCode: 'AC', label: "Frais d'établissement" },
  { code: 'CX', brutCode: 'CX', amortCode: 'CQ', label: 'Frais de développement' },
  {
    code: 'AF',
    brutCode: 'AF',
    amortCode: 'AG',
    label: 'Concessions, brevets et droits similaires',
  },
  { code: 'AH', brutCode: 'AH', amortCode: 'AI', label: 'Fonds commercial' },
  { code: 'AJ', brutCode: 'AJ', amortCode: 'AK', label: 'Autres immobilisations incorporelles' },
  {
    code: 'AL',
    brutCode: 'AL',
    amortCode: 'AM',
    label: 'Immobilisations incorporelles en cours, avances et acomptes',
  },
  { code: 'AN', brutCode: 'AN', amortCode: 'AO', label: 'Terrains' },
  { code: 'AP', brutCode: 'AP', amortCode: 'AQ', label: 'Constructions' },
  {
    code: 'AR',
    brutCode: 'AR',
    amortCode: 'AS',
    label: 'Installations techniques, matériel et outillage industriels',
  },
  { code: 'AT', brutCode: 'AT', amortCode: 'AU', label: 'Autres immobilisations corporelles' },
  {
    code: 'AV',
    brutCode: 'AV',
    amortCode: 'AW',
    label: 'Immobilisations corporelles en cours, avances et acomptes',
  },
  { code: 'CS', brutCode: 'CS', amortCode: 'CT', label: 'Participations' },
  {
    code: 'CU',
    brutCode: 'CU',
    amortCode: 'CV',
    label: "Titres immobilisés de l'activité de portefeuille",
  },
  {
    code: 'BB',
    brutCode: 'BB',
    amortCode: 'BC',
    label: 'Créances rattachées à des participations',
  },
  { code: 'BD', brutCode: 'BD', amortCode: 'BE', label: 'Autres titres immobilisés' },
  { code: 'BF', brutCode: 'BF', amortCode: 'BG', label: 'Prêts' },
  { code: 'BH', brutCode: 'BH', amortCode: 'BI', label: 'Autres immobilisations financières' },
  { code: 'BL', brutCode: 'BL', amortCode: 'BM', label: 'Matières premières, approvisionnements' },
  { code: 'BN', brutCode: 'BN', amortCode: 'BO', label: 'En cours de production de biens' },
  { code: 'BP', brutCode: 'BP', amortCode: 'BQ', label: 'En cours de production de services' },
  { code: 'BR', brutCode: 'BR', amortCode: 'BS', label: 'Produits intermédiaires et finis' },
  { code: 'BT', brutCode: 'BT', amortCode: 'BU', label: 'Marchandises' },
  { code: 'BV', brutCode: 'BV', amortCode: '', label: 'Avances et acomptes versés sur commandes' },
  { code: 'BX', brutCode: 'BX', amortCode: 'BY', label: 'Clients et comptes rattachés' },
  { code: 'BZ', brutCode: 'BZ', amortCode: 'CA', label: 'Autres créances' },
  { code: 'CB', brutCode: 'CB', amortCode: '', label: 'Capital souscrit et appelé, non versé' },
  { code: 'CD', brutCode: 'CD', amortCode: 'CE', label: 'Valeurs mobilières de placement' },
  { code: 'CF', brutCode: 'CF', amortCode: '', label: 'Disponibilités' },
  { code: 'CH', brutCode: 'CH', amortCode: '', label: "Charges constatées d'avance" },
  { code: 'CW', brutCode: 'CW', amortCode: '', label: "Frais d'émission d'emprunt" },
  { code: 'CM', brutCode: 'CM', amortCode: '', label: 'Primes de remboursement des emprunts' },
  {
    code: 'CN',
    brutCode: 'CN',
    amortCode: '',
    label: "Écarts de conversion actif et différences d'évaluation",
  },
];

const PASSIF_ROWS: { code: string; label: string }[] = [
  { code: 'DA', label: 'Capital social ou individuel' },
  { code: 'DB', label: "Primes d'émission, de fusion, d'apport" },
  { code: 'DC', label: 'Écarts de réévaluation' },
  { code: 'DD', label: 'Réserve légale' },
  { code: 'DE', label: 'Réserves statutaires ou contractuelles' },
  { code: 'DF', label: 'Réserves réglementées' },
  { code: 'DG', label: 'Autres réserves' },
  { code: 'DH', label: 'Report à nouveau' },
  { code: 'DJ', label: "Subventions d'investissement" },
  { code: 'DK', label: 'Provisions réglementées' },
  { code: 'DM', label: 'Produit des émissions de titres participatifs' },
  { code: 'DN', label: 'Avances conditionnées' },
  { code: 'DP', label: 'Provisions pour risques' },
  { code: 'DQ', label: 'Provisions pour charges' },
  { code: 'DS', label: 'Emprunts obligataires convertibles' },
  { code: 'DT', label: 'Autres emprunts obligataires' },
  { code: 'DU', label: 'Emprunts et dettes auprès des établissements de crédit' },
  { code: 'DV', label: 'Emprunts et dettes financières divers' },
  { code: 'DW', label: 'Avances et acomptes reçus sur commandes en cours' },
  { code: 'DX', label: 'Dettes fournisseurs et comptes rattachés' },
  { code: 'DY', label: 'Dettes fiscales et sociales' },
  { code: 'DZ', label: 'Dettes sur immobilisations et comptes rattachés' },
  { code: 'EA', label: 'Autres dettes' },
  { code: 'EB', label: "Produits constatés d'avance" },
  { code: 'ED', label: "Écart de conversion passif et différences d'évaluation" },
];

/**
 * Pure computation. `resultatDeLExercice` is HN from
 * computeCompteResultat2052_2053 — must be computed first, see spec §5.2/
 * §6: account 12 (120/129) reads 0.00 within the fiscal year itself in
 * this app (a-nouveau.service.ts posts a year's result into 120/129 only
 * as part of the *following* year's opening entry), so DI cannot be a
 * ledger read.
 */
export function computeBilan2050(
  accounts: TrialBalanceAccount[],
  resultatDeLExercice: Money,
): Bilan2050 {
  const totals = classifyAccounts(accounts, [...ACTIF_RULES, ...PASSIF_RULES], DUAL_NATURE_RULES);

  const actif: BilanActifLigne[] = ACTIF_ROWS.map((row) => {
    const brut = totals.get(row.brutCode) ?? Money.zero();
    const amort = row.amortCode ? (totals.get(row.amortCode) ?? Money.zero()) : Money.zero();
    return {
      code: row.code,
      label: row.label,
      brut: brut.toApiString(),
      amortissements: amort.toApiString(),
      net: brut.minus(amort).toApiString(),
    };
  });
  const totalActifBrut = actif.reduce((sum, l) => sum.plus(Money.fromString(l.brut)), Money.zero());
  const totalActifAmortissements = actif.reduce(
    (sum, l) => sum.plus(Money.fromString(l.amortissements)),
    Money.zero(),
  );

  const passif: BilanPassifLigne[] = PASSIF_ROWS.map((row) => ({
    code: row.code,
    label: row.label,
    montant: (totals.get(row.code) ?? Money.zero()).toApiString(),
  }));

  const totalPassifExcludingResultat = passif.reduce(
    (sum, l) => sum.plus(Money.fromString(l.montant)),
    Money.zero(),
  );
  const totalPassif = totalPassifExcludingResultat.plus(resultatDeLExercice);

  return {
    actif,
    totalActifBrut: totalActifBrut.toApiString(),
    totalActifAmortissements: totalActifAmortissements.toApiString(),
    totalActifNet: totalActifBrut.minus(totalActifAmortissements).toApiString(),
    passif,
    resultatDeLExercice: resultatDeLExercice.toApiString(),
    totalPassif: totalPassif.toApiString(),
  };
}

/**
 * Which Actif line an immobilisation account rolls up to — used by
 * LiasseService to group FixedAssets for the VNC cross-check (see
 * liasse-articulation.ts). Only ever called with a class-2 account
 * number (accounts.service enforces pcgClass === 2 for
 * FixedAsset.accountId at creation time), so it only ever matches one of
 * ACTIF_RULES' brut (debit-direction) entries — reuses the same
 * "exactly one match, else throw" discipline as classifyAccounts rather
 * than a separate lookup that could silently diverge from it.
 */
export function resolveImmobilisationLineCode(accountNumber: string): string {
  const brutRules = ACTIF_RULES.filter((rule) => rule.direction === 'debit');
  const matches = brutRules.filter((rule) =>
    rule.prefixes.some((prefix) => accountNumber.startsWith(prefix)),
  );
  if (matches.length === 0) {
    throw new BadRequestException(
      `Immobilisation account "${accountNumber}" has no Actif line mapping — see ` +
        'specs/liasse-2050-implementation-spec.md §3a.',
    );
  }
  if (matches.length > 1) {
    throw new ConflictException(
      `Immobilisation account "${accountNumber}" matches more than one Actif line ` +
        `(${matches.map((m) => m.code).join(', ')}) — the mapping's prefix rules overlap.`,
    );
  }
  return matches[0].code;
}

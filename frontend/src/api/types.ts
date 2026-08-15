/**
 * Hand-authored response types mirroring the JSON the API actually sends.
 *
 * These are deliberately NOT imported from the backend's Prisma-generated
 * types: Prisma types money fields as `Prisma.Decimal`, but the wire
 * format (confirmed live: `"debit":"10.00"`) is a string — Decimal.js's
 * toJSON() serializes it that way. Reusing the Prisma type here would
 * claim `debit: Decimal` for a field that is actually `string` on the
 * wire, which is worse than no shared type at all. See request DTOs
 * (imported directly from the backend as `import type`) for the case
 * where sharing is safe: those are already string-typed by design.
 */

export interface Journal {
  id: string;
  companyId: string;
  code: string;
  label: string;
  type: 'ACHATS' | 'VENTES' | 'BANQUE' | 'CAISSE' | 'OPERATIONS_DIVERSES' | 'A_NOUVEAU';
}

export interface Account {
  id: string;
  companyId: string;
  number: string;
  label: string;
  pcgClass: number;
  isAuxiliary: boolean;
  parentId: string | null;
}

export interface Company {
  id: string;
  name: string;
  jurisdiction: 'FR' | 'MC';
  /** Selects which liasse (2050-series vs. 2033-series) is the official/fileable one — see LiassePage. */
  regime: 'REEL_NORMAL' | 'REEL_SIMPLIFIE';
  siren: string | null;
  rci: string | null;
  vatNumber: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
}

export interface VatRate {
  id: string;
  companyId: string;
  label: string;
  /** Percentage string, e.g. "20.00" — same Decimal-serializes-as-string convention as money. */
  ratePercent: string;
  validFrom: string;
  validTo: string | null;
}

/** One collectée rate line (08/09/9B/T6) — see ca3-declaration.ts on the backend. */
export interface Ca3RateLine {
  ligne: string;
  label: string;
  ratePercent: string;
  /** Money string, rounded to the nearest euro at the declaration boundary. */
  baseHT: string;
  /** Money string, rounded to the nearest euro at the declaration boundary. */
  taxe: string;
}

/** Response for POST /vat/declaration — French CA3 (régime réel normal), basic case only. */
export interface Ca3Declaration {
  periodStart: string;
  periodEnd: string;
  collecteeByRate: Ca3RateLine[];
  /** Ligne 16 — total de la TVA brute due. Money string. */
  ligne16: string;
  /** Ligne 19 — biens constituant des immobilisations. Money string. */
  ligne19: string;
  /** Ligne 20 — autres biens et services. Money string. */
  ligne20: string;
  /** Ligne 23 — total TVA déductible. Money string. */
  ligne23: string;
  /** Ligne 25 — crédit de TVA (23 − 16), only when 23 > 16. Money string, null otherwise. */
  ligne25: string | null;
  /** Ligne TD — TVA due (16 − 23), only when 16 ≥ 23. Money string, null otherwise. */
  ligneTD: string | null;
  /** Ligne 28 — TVA nette due. Money string. */
  ligne28: string;
  /** Ligne 32 — total à payer. Money string. */
  ligne32: string;
}

export interface FiscalYear {
  id: string;
  companyId: string;
  label: string;
  startDate: string;
  endDate: string;
  closedAt: string | null;
}

export interface EcritureLigne {
  id: string;
  companyId: string;
  ecritureId: string;
  compteId: string;
  compteAuxId: string | null;
  /** Money string, e.g. "1234.56". Never parse into a number — see lib/money.ts. */
  debit: string;
  /** Money string, e.g. "1234.56". Never parse into a number — see lib/money.ts. */
  credit: string;
  lettrage: string | null;
  dateLettrage: string | null;
  montantDevise: string | null;
  idDevise: string | null;
  vatRateId: string | null;
}

export interface Ecriture {
  id: string;
  companyId: string;
  fiscalYearId: string;
  journalId: string;
  ecritureNum: string | null;
  ecritureDate: string;
  pieceRef: string | null;
  pieceDate: string | null;
  libelle: string;
  validatedAt: string | null;
  reversesId: string | null;
  importBatchId: string | null;
  createdAt: string;
  updatedAt: string;
  lignes: EcritureLigne[];
}

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  /** NestJS's ValidationPipe sends an array (one message per failed rule); domain errors send a single string. */
  message: string | string[];
}

export interface LedgerTotals {
  debit: string;
  credit: string;
  balance: string;
}

export interface TrialBalanceLine {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  totalDebit: string;
  totalCredit: string;
  balance: string;
}

export interface TrialBalanceResponse {
  fiscalYearId: string;
  periodStart?: string;
  periodEnd?: string;
  lines: TrialBalanceLine[];
  totals: LedgerTotals;
}

export interface AccountLedgerLine {
  ecritureId: string;
  ecritureNum: string | null;
  journalCode: string;
  ecritureDate: string;
  pieceRef?: string | null;
  libelle: string;
  debit: string;
  credit: string;
  lettrage?: string | null;
  runningBalance: string;
}

export interface AccountLedgerResponse {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  fiscalYearId: string;
  periodStart?: string;
  periodEnd?: string;
  lines: AccountLedgerLine[];
  totals: LedgerTotals;
}

export interface ImportPreviewLigne {
  compteNum: string;
  compteLib: string;
  debit: string;
  credit: string;
}

export interface ImportPreviewEcriture {
  ecritureRef: string;
  journalCode: string;
  ecritureDate: string;
  libelle: string;
  pieceRef?: string;
  /** Money string — total debit, which always equals total credit for a valid group. */
  total: string;
  lignes: ImportPreviewLigne[];
  isDuplicate: boolean;
  duplicateOf?: string;
}

export interface ImportPreviewRejected {
  ecritureRef: string;
  errors: string[];
}

/** Response for POST /import-excel/preview — writes nothing, purely informational. */
export interface ImportPreviewResponse {
  fileErrors: string[];
  toImport: ImportPreviewEcriture[];
  rejected: ImportPreviewRejected[];
}

/** Response shape for GET /depreciation/fixed-assets(/:id) — see FixedAssetListItemDto on the backend. */
export interface FixedAsset {
  id: string;
  label: string;
  accountId: string;
  depreciationAccountId: string;
  expenseAccountId: string;
  acquisitionDate: string;
  serviceStartDate: string;
  /** Money string. */
  acquisitionValue: string;
  /** Money string. */
  residualValue: string;
  usefulLifeYears: number;
  method: 'LINEAR' | 'DECLINING';
  cessionDate: string | null;
  /** Money string. */
  cessionPrice: string | null;
  /** Money string. Equal to acquisitionValue. */
  valeurBrute: string;
  /** Money string. Sum of posted dotations only. */
  amortissementsCumules: string;
  /** Money string. valeurBrute - amortissementsCumules. */
  vnc: string;
}

/** One line of an asset's plan d'amortissement — see DepreciationEntryDto on the backend. */
export interface DepreciationEntry {
  id: string;
  fiscalYearId: string;
  fiscalYearLabel: string;
  /** Money string. */
  amount: string;
  postedEcritureId: string | null;
  postedEcritureNum: string | null;
}

export interface ImportBatch {
  id: string;
  companyId: string;
  fileName: string;
  status: 'PENDING' | 'COMMITTED' | 'FAILED';
  errors: string[] | null;
  createdAt: string;
  ecritures?: Ecriture[];
}

/** One Actif row (2050) — Brut/Amortissements are ledger money strings, Net = Brut − Amortissements. */
export interface BilanActifLigne {
  code: string;
  label: string;
  brut: string;
  amortissements: string;
  net: string;
}

/** One Passif row (2051) — already net, no Brut/Amortissements split. */
export interface BilanPassifLigne {
  code: string;
  label: string;
  montant: string;
}

/** Response shape for the bilan half of POST /liasse/generate — see bilan-2050.ts on the backend. */
export interface Bilan2050 {
  actif: BilanActifLigne[];
  /** CO — Actif total, colonne Brut. */
  totalActifBrut: string;
  /** 1A — Actif total, colonne Amortissements/provisions. */
  totalActifAmortissements: string;
  /** CO − 1A — uncoded on the real form itself. */
  totalActifNet: string;
  /** Includes DH (Report à nouveau — may legitimately be negative). DI is not in this array. */
  passif: BilanPassifLigne[];
  /** DI — Résultat de l'exercice. Constructed from the compte de résultat's HN, not a ledger read. */
  resultatDeLExercice: string;
  /** EE — Passif total. */
  totalPassif: string;
}

export interface CompteResultatLigne {
  code: string;
  label: string;
  montant: string;
}

/** Response shape for the compte-de-résultat half of POST /liasse/generate — see compte-resultat-2052-2053.ts. */
export interface CompteResultat2052_2053 {
  /** Every line, in form order, for a screen that shows the real form's codes — see compte-resultat-2052-2053.ts's CDR_RULES. */
  lignes: CompteResultatLigne[];
  /** FR — total des produits d'exploitation (I). */
  totalProduitsExploitation: string;
  /** GF — total des charges d'exploitation (II). */
  totalChargesExploitation: string;
  /** GG — résultat d'exploitation (I − II). */
  resultatExploitation: string;
  /** GH — bénéfice attribué ou perte transférée (III). Always null — opérations en commun deferred. */
  beneficeAttribueOuPerteTransferee: string | null;
  /** GI — perte supportée ou bénéfice transféré (IV). Always null, same reason. */
  perteSupporteeOuBeneficeTransfere: string | null;
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
  /** HL — total des produits. */
  totalProduits: string;
  /** HM — total des charges. */
  totalCharges: string;
  /** HN — bénéfice ou perte. Feeds bilan.resultatDeLExercice. */
  beneficeOuPerte: string;
}

/** One 2054 row — cessions/virements are always "0.00", see tableau-2054.ts's doc comment. */
export interface Tableau2054Ligne {
  code: string;
  label: string;
  valeurBruteDebut: string;
  acquisitions: string;
  cessions: string;
  virements: string;
  valeurBruteFin: string;
}

/** Response shape for the 2054 half of POST /liasse/generate — see tableau-2054.ts on the backend. */
export interface Tableau2054 {
  lignes: Tableau2054Ligne[];
  totalIncorporelles: string;
  totalCorporelles: string;
  totalFinancieres: string;
  totalGeneral: string;
}

/** One 2055 row — diminutions is always "0.00", see tableau-2055.ts's doc comment. */
export interface Tableau2055Ligne {
  code: string;
  label: string;
  montantDebut: string;
  dotations: string;
  diminutions: string;
  montantFin: string;
}

/** Response shape for the 2055 half of POST /liasse/generate — see tableau-2055.ts on the backend. */
export interface Tableau2055 {
  lignes: Tableau2055Ligne[];
  totalIncorporelles: string;
  totalCorporelles: string;
  totalGeneral: string;
}

/** One 2056 row — see tableau-2056.ts's doc comment for how début/dotations/reprises are derived (no dedicated domain model, split by à-nouveau vs. non-à-nouveau journal lines). */
export interface Tableau2056Ligne {
  code: string;
  label: string;
  montantDebut: string;
  dotations: string;
  reprises: string;
  montantFin: string;
}

/** Response shape for the 2056 half of POST /liasse/generate — see tableau-2056.ts on the backend. */
export interface Tableau2056 {
  lignes: Tableau2056Ligne[];
  /** TOTAL I (fin) — provisions réglementées. */
  totalReglementees: string;
  /** TOTAL II (fin) — provisions pour risques et charges. */
  totalRisquesCharges: string;
  /** TOTAL III (fin) — provisions pour dépréciation. */
  totalDepreciation: string;
  /** TOTAL GÉNÉRAL (I+II+III), fin. */
  totalGeneral: string;
  /** UE/UF, UG/UH, UJ/UK — dont dotations/reprises par nature. Never computed, see tableau-2056.ts's doc comment. */
  dontDotationsReprisesParNature: null;
}

/** One 2057 row — montant brut only, no maturity split. See tableau-2057.ts's doc comment: every row reproduces one Bilan2050 actif/passif line. */
export interface Tableau2057Ligne {
  code: string;
  label: string;
  montantBrut: string;
}

/**
 * Response shape for the 2057 half of POST /liasse/generate — see
 * tableau-2057.ts on the backend. Maturity (à plus/moins d'un an) is
 * genuinely blocked — no due-date field exists anywhere in the schema —
 * see `note`.
 */
export interface Tableau2057 {
  cadreA: Tableau2057Ligne[];
  totalCreances: string;
  cadreB: Tableau2057Ligne[];
  totalDettes: string;
  note: string;
}

/** Cadre A row shape (valeur résiduelle des éléments cédés) — "valeur nette réévaluée" and "amortissements en franchise d'impôt" aren't represented, see tableau-2059.ts's doc comment. */
export interface Tableau2059ACadreARow {
  accountNumber: string;
  valeurOrigine: string;
  amortissements: string;
  valeurResiduelle: string;
}

/** Cadre B row shape (plus-values/moins-values). `qualification` is always null — the court-terme/long-terme tax split isn't computed, see tableau-2059.ts's doc comment. */
export interface Tableau2059ACadreBRow {
  accountNumber: string;
  prixDeVente: string;
  plusOuMoinsValue: string;
  qualification: 'COURT_TERME' | 'LONG_TERME' | null;
}

/**
 * Response shape for the 2059-A half of POST /liasse/generate — see
 * tableau-2059.ts on the backend. cadreA/cadreB now hold one row per
 * asset disposed within the reported fiscal year.
 */
export interface Tableau2059A {
  cadreA: Tableau2059ACadreARow[];
  cadreB: Tableau2059ACadreBRow[];
  /** CADRE A total — plus/moins-value nette à court terme. Always "0.00" — the tax qualification isn't computed, see `note`. */
  totalCourtTerme: string;
  /** CADRE B total — plus/moins-value nette à long terme. Always "0.00" — same reason. */
  totalLongTerme: string;
  /** The real, computed net plus/moins-value across every disposal this year, not yet allocated between court/long terme. */
  totalNonQualifie: string;
  note: string;
}

/** Response for POST /liasse/generate — régime réel normal (2050-series) only, see LiasseService.generate. */
export interface LiasseResult {
  bilan: Bilan2050;
  compteResultat: CompteResultat2052_2053;
  tableau2054: Tableau2054;
  tableau2055: Tableau2055;
  tableau2056: Tableau2056;
  tableau2057: Tableau2057;
  tableau2059: Tableau2059A;
}

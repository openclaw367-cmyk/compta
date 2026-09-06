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
  /** Tiers-identity fields, captured once at "+ Nouveau tiers" time — see
   *  CollectifTiersCard / TiersFormModal. Meaningful only when isAuxiliary
   *  is true; pre-fills InvoiceEditor's own client-identity fields. */
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  countryCode: string | null;
  sirenOrRci: string | null;
  vatNumber: string | null;
}

/** Shared alias — used wherever a regime needs to be named explicitly, e.g. the line-trace query params. */
export type Regime = 'REEL_NORMAL' | 'REEL_SIMPLIFIE';

/** TVA exigibilité regime for services revenue (compte 706) — CGI art. 269, 2-c. See
 *  CLAUDE.md "Invoicing — cash-basis VAT". Goods revenue is unaffected. */
export type RegimeTvaServices = 'ENCAISSEMENTS' | 'DEBITS';

export type MembershipRole = 'OWNER' | 'MEMBER' | 'READ_ONLY';

export interface Company {
  id: string;
  name: string;
  jurisdiction: 'FR' | 'MC';
  /** Selects which liasse (2050-series vs. 2033-series) is the official/fileable one — see LiassePage. */
  regime: Regime;
  siren: string | null;
  rci: string | null;
  vatNumber: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  /** Shown in the invoice PDF's own header contact block, when set — see CompanyProfilePage. */
  phone: string | null;
  email: string | null;
  regimeTvaServices: RegimeTvaServices;
  bankName: string | null;
  iban: string | null;
  bic: string | null;
  /**
   * The CALLER's own role on this company — only present on results from
   * GET /companies (membership-scoped), absent on GET /companies/current
   * (which doesn't echo it back). See CLAUDE.md "Multi-user / roles &
   * permissions".
   */
  role?: MembershipRole;
}

export interface Member {
  id: string;
  userId: string;
  email: string;
  role: MembershipRole;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: MembershipRole;
  expiresAt: string;
  createdAt: string;
}

export type ActivityEventType =
  | 'MEMBER_INVITED'
  | 'MEMBER_INVITE_ACCEPTED'
  | 'MEMBER_ROLE_CHANGED'
  | 'MEMBER_REMOVED';

/** A single row from GET /activity — see CLAUDE.md "Activity feed". */
export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  actorEmail: string;
  targetEmail: string | null;
  detail: string | null;
  createdAt: string;
}

export interface MembershipsList {
  members: Member[];
  pendingInvites: PendingInvite[];
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
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
  /** Due date — feeds the 2057 maturity split. Null on lines with no due-date concept and on historical lines predating this field. */
  dateEcheance: string | null;
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
  /** How many documents (justificatifs) are attached — see EcrituresList's paperclip indicator. */
  documentCount: number;
}

/**
 * A justificatif attached to an écriture — see CLAUDE.md "Supporting-
 * document attachments". Metadata only; the file itself is fetched
 * separately via api.getBlob() against the /file route (never a plain
 * <img src>, since that route requires the x-company-id header).
 */
export interface EcritureDocument {
  id: string;
  companyId: string;
  ecritureId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  uploadedAt: string;
}

export type DocumentAuditAction = 'ATTACHED' | 'REPLACED' | 'REMOVED';

/**
 * One row of an écriture's document attach/replace/remove history — no
 * "who", since this app has no authentication/user-identity model to
 * honestly attribute one (see CLAUDE.md).
 */
export interface EcritureDocumentAuditEntry {
  id: string;
  action: DocumentAuditAction;
  fileName: string;
  occurredAt: string;
}

/**
 * Response for POST /documents/extract — deterministic parsing only, same
 * "found and parsed, or simply absent — never guessed" discipline as the
 * assistant's own extract_invoice_facts (InvoiceExtractionService is
 * reused verbatim, not reimplemented — see CLAUDE.md).
 */
export interface ExtractedInvoiceField {
  value: string;
  source: 'parsed';
}

export interface ExtractedInvoiceFacts {
  fileName: string;
  fields: {
    montantTtc?: ExtractedInvoiceField;
    montantHt?: ExtractedInvoiceField;
    montantTva?: ExtractedInvoiceField;
    numeroFacture?: ExtractedInvoiceField;
    dateFacture?: ExtractedInvoiceField;
  };
  rawText: string;
}

/**
 * Response for POST /entries and PATCH /entries/:id only — the écriture
 * plus any non-blocking compliance warnings (see EntriesService's
 * "orphaned immobilisation" guard in CLAUDE.md). Every other read of an
 * Ecriture (list, find one, validate, reverse) stays the plain shape.
 */
export interface EcritureWriteResult extends Ecriture {
  warnings: string[];
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
  documentCount: number;
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

// --- FEC file import (.txt/.csv/.xlsx) — see CLAUDE.md "FEC import" ---

export interface FecImportPlannedJournal {
  code: string;
  label: string;
  inferredType: string;
  typeConfident: boolean;
}

export interface FecImportPlannedAccount {
  number: string;
  label: string;
  pcgClass: number;
  isAuxiliary: boolean;
  parentNumber: string | null;
}

export interface FecImportFiscalYearPlan {
  action: 'REUSE_EXISTING' | 'CREATE_NEW';
  fiscalYearId?: string;
  label: string;
  startDate: string;
  endDate: string;
}

export interface FecImportPreviewLigne {
  compteNum: string;
  compteLib: string;
  compAuxNum: string | null;
  debit: string;
  credit: string;
}

export interface FecImportPreviewEcriture {
  journalCode: string;
  sourceEcritureNum: string;
  ecritureDate: string;
  libelle: string;
  pieceRef: string | null;
  total: string;
  lignes: FecImportPreviewLigne[];
  isDuplicate: boolean;
  duplicateOf?: string;
}

export interface FecImportRejectedGroup {
  journalCode: string;
  sourceEcritureNum: string;
  errors: string[];
}

/** Response for POST /fec-import/preview — writes nothing, purely informational. */
export interface FecImportPreviewResponse {
  fileErrors: string[];
  fiscalYearPlan: FecImportFiscalYearPlan | null;
  journalsToCreate: FecImportPlannedJournal[];
  accountsToCreate: FecImportPlannedAccount[];
  toImport: FecImportPreviewEcriture[];
  totalEcrituresCount: number;
  truncated: boolean;
  rejected: FecImportRejectedGroup[];
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

/** Response for POST /depreciation/fixed-assets/:id/cession — see CessionResultDto on the backend. */
export interface CessionResult {
  finalDotationEcritureNum: string | null;
  cessionEcritureNum: string;
  /** Money string. VNC at the date of cession. */
  vnc: string;
  /** Money string. Sale proceeds. */
  cessionPrice: string;
  /** Money string, signed. cessionPrice - vnc. */
  plusOuMoinsValue: string;
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

/** One 2057 Cadre A row — see tableau-2057.ts's doc comment: montantBrut reproduces one Bilan2050 actif line; aUnAnAuPlus/aPlusDUnAn are the maturity split, computed from EcritureLigne.dateEcheance (a line with none defaults to aUnAnAuPlus — see the result's own maturityNote). */
export interface Tableau2057CadreALigne {
  code: string;
  label: string;
  montantBrut: string;
  aUnAnAuPlus: string;
  aPlusDUnAn: string;
}

/** One 2057 Cadre B row — same idea, three-way split (≤1an / 1-5ans / >5ans). */
export interface Tableau2057CadreBLigne {
  code: string;
  label: string;
  montantBrut: string;
  aUnAnAuPlus: string;
  aPlusDUnAnEt5AnsAuPlus: string;
  aPlusDe5Ans: string;
}

/** Response shape for the 2057 half of POST /liasse/generate — see tableau-2057.ts on the backend. */
export interface Tableau2057 {
  cadreA: Tableau2057CadreALigne[];
  totalCreances: string;
  cadreB: Tableau2057CadreBLigne[];
  totalDettes: string;
  note: string;
  /** Explains the maturity split's default-bucket convention and the still-unbuilt origin-based split on emprunts. */
  maturityNote: string;
}

/** Cadre A row shape (valeur résiduelle des éléments cédés) — "valeur nette réévaluée" and "amortissements en franchise d'impôt" aren't represented, see tableau-2059.ts's doc comment. */
export interface Tableau2059ACadreARow {
  /** Added 2026-08-29 for the traceability drill-down — 2059-A rows are keyed by asset, not account (accountNumber isn't unique if two disposed assets share a gross account). */
  assetId: string;
  accountNumber: string;
  valeurOrigine: string;
  amortissements: string;
  valeurResiduelle: string;
}

/** Cadre B row shape (plus-values/moins-values). `qualification` is always null — the court-terme/long-terme tax split isn't computed, see tableau-2059.ts's doc comment. */
export interface Tableau2059ACadreBRow {
  assetId: string;
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

/** Régime réel normal (2050-series) result — see LiasseService.generate. */
export interface LiasseResult {
  regime: 'REEL_NORMAL';
  bilan: Bilan2050;
  compteResultat: CompteResultat2052_2053;
  tableau2054: Tableau2054;
  tableau2055: Tableau2055;
  tableau2056: Tableau2056;
  tableau2057: Tableau2057;
  tableau2059: Tableau2059A;
}

/** One Actif row (2033-A) — Brut/Amortissements are ledger money strings, Net = Brut − Amortissements. Coarser grouping than Bilan2050 — see bilan-2033-a.ts's doc comment. */
export interface Bilan2033AActifLigne {
  code: string;
  label: string;
  brut: string;
  amortissements: string;
  net: string;
}

/** One Passif row (2033-A) — already net, no Brut/Amortissements split. */
export interface Bilan2033APassifLigne {
  code: string;
  label: string;
  montant: string;
}

/** Response shape for the bilan simplifié half of a REEL_SIMPLIFIE liasse — see bilan-2033-a.ts on the backend. */
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
  /** Net = Brut − Amortissements, uncoded on the form itself. */
  totalActifNet: string;
  /** Includes 134 (Report à nouveau — may legitimately be negative). 136 is not in this array — see resultatDeLExercice. */
  passif: Bilan2033APassifLigne[];
  /** 142 — Total I (Capitaux propres), EXCLUDING 136 (Résultat) — add resultatDeLExercice for the form's own Total I. */
  totalIPassifExcludingResultat: string;
  /** 136 — Résultat de l'exercice. Not a ledger read — constructed from the compte de résultat's ligne 310. */
  resultatDeLExercice: string;
  /** 154 — Total II (Provisions pour risques et charges). */
  totalIIPassif: string;
  /** 176 — Total III (Dettes). */
  totalIIIPassif: string;
  /** 180 — Total général (I + II + III). */
  totalPassif: string;
}

export interface CompteResultat2033BLigne {
  code: string;
  label: string;
  montant: string;
}

/** Response shape for the compte de résultat simplifié half of a REEL_SIMPLIFIE liasse — "A - RÉSULTAT COMPTABLE" section only, see compte-resultat-2033-b.ts on the backend. */
export interface CompteResultat2033B {
  /** Every line, in form order (cases 209–306). */
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
  /** 310 — Bénéfices ou pertes. Feeds Bilan2033A.resultatDeLExercice. */
  beneficeOuPerte: string;
}

/**
 * Régime réel simplifié result — bilan simplifié (2033-A) + compte de
 * résultat simplifié (2033-B, résultat comptable only). No annexe
 * equivalents (2033-C onward) — see LiasseService on the backend.
 */
export interface LiasseSimplifieResult {
  regime: 'REEL_SIMPLIFIE';
  bilan: Bilan2033A;
  compteResultat: CompteResultat2033B;
}

/** Either regime's liasse — discriminate on `.regime`. Both /liasse/generate and /liasse/generate-secondary return this union. */
export type LiasseAnyResult = LiasseResult | LiasseSimplifieResult;

/**
 * Flux d'exploitation — see cash-flow-statement.ts's CAF formula and the
 * gross-vs-net (brut, not net) discipline on variationCreancesClients/
 * variationStocks. total = capaciteAutofinancement − variationCreancesClients
 * − variationStocks − variationTvaDeductibleAutres + variationDettesExploitation.
 */
export interface FluxExploitation {
  resultatNet: string;
  dotationsAmortissementsProvisions: string;
  reprisesAmortissementsProvisions: string;
  valeurComptableElementsCedes: string;
  produitsDesCessions: string;
  capaciteAutofinancement: string;
  variationCreancesClients: string;
  variationStocks: string;
  /** Δ445660 (TVA déductible sur autres biens et services) — carved out of BZ, see cash-flow-statement.ts's doc comment. */
  variationTvaDeductibleAutres: string;
  variationDettesExploitation: string;
  total: string;
}

/** Flux d'investissement — cash actually paid/received nets against Δ404/405, Δ462, and Δ445662, see cash-flow-statement.ts. */
export interface FluxInvestissement {
  acquisitionsImmobilisations: string;
  /** Δ445662 (TVA déductible sur immobilisations) — carved out of BZ, added to acquisitions (HT → TTC) before netting against DZ. */
  variationTvaDeductibleImmobilisations: string;
  variationDettesSurImmobilisations: string;
  cessionsImmobilisations: string;
  variationCreancesSurCessions: string;
  total: string;
}

/** Flux de financement — distributions is always "0.00", see cash-flow-statement.ts's doc comment. */
export interface FluxFinancement {
  variationEmprunts: string;
  variationCapital: string;
  /** Δ raw account 455 (comptes courants d'associés), credit − debit — positive when associés advance more cash to the company. */
  variationComptesCourantsAssocies: string;
  distributions: string;
  total: string;
}

/**
 * Response shape for POST /cash-flow/generate — tableau des flux de
 * trésorerie, méthode indirecte. See cash-flow-statement.ts on the
 * backend: variationTresorerie (the sum of the three sections' totals)
 * must equal tresorerieCloture − tresorerieOuverture — the backend
 * itself refuses (409) if it doesn't, so a successful response here is
 * already a reconciled one, not just a computed one.
 */
export interface CashFlowStatement {
  fluxExploitation: FluxExploitation;
  fluxInvestissement: FluxInvestissement;
  fluxFinancement: FluxFinancement;
  variationTresorerie: string;
  tresorerieOuverture: string;
  tresorerieCloture: string;
}

/** Soldes intermédiaires de gestion — see financial-analysis.ts's computeSigCascade on the backend. */
export interface SigCascade {
  margeCommerciale: string;
  productionDeLExercice: string;
  consommationsEnProvenanceDesTiers: string;
  valeurAjoutee: string;
  ebe: string;
  resultatExploitation: string;
  resultatFinancier: string;
  resultatCourantAvantImpots: string;
  resultatExceptionnel: string;
  resultatNet: string;
}

/** Percentages as plain decimal strings ("40.00" = 40.00%) — null ("n/a") when the denominator (CA) is exactly zero. */
export interface Margins {
  chiffreDAffaires: string;
  margeBrute: string | null;
  margeEbe: string | null;
  margeExploitation: string | null;
  margeNette: string | null;
}

/** A snapshot at fiscal-year end, not a delta — see financial-analysis.ts's doc comment for the exploitation/hors-exploitation scope. */
export interface BfrSnapshot {
  bfrExploitation: string;
  bfrHorsExploitation: string;
  bfrTotal: string;
}

export interface FondsDeRoulement {
  ressourcesStables: string;
  emploisStables: string;
  fondsDeRoulement: string;
}

/** parFrMoinsBfr = FR − BFR + provisionsSurActifCirculant, asserted equal to disponibilites — see financial-analysis.ts's doc comment for why the third term is needed. */
export interface TresorerieNette {
  parFrMoinsBfr: string;
  provisionsSurActifCirculant: string;
  disponibilites: string;
}

export interface FreeCashFlow {
  fluxExploitation: string;
  cashPaidForAcquisitions: string;
  freeCashFlow: string;
}

/** bookEnterpriseValue is book-based (equity + net debt) — explicitly NOT a valuation. */
export interface EndettementEtCapitaux {
  dettesFinancieres: string;
  tresorerieEtEquivalents: string;
  endettementNet: string;
  capitauxPropres: string;
  bookEnterpriseValue: string;
}

/** taux is a percentage string, null ("n/a") when dettesFinancieres is exactly 0.00. */
export interface CoutDeLaDette {
  chargesDInteret: string;
  dettesFinancieres: string;
  taux: string | null;
}

/** Ratios are ratio/percentage/day-count strings, each null ("n/a") when its own denominator is exactly zero — never a divide-by-zero. */
export interface Ratios {
  liquiditeGenerale: string | null;
  liquiditeReduite: string | null;
  gearing: string | null;
  autonomieFinanciere: string | null;
  roe: string | null;
  roa: string | null;
  roce: string | null;
  rentabiliteExploitation: string | null;
  dsoClients: string | null;
  dpoFournisseurs: string | null;
  rotationStocks: string | null;
}

/**
 * Response shape for POST /financial-analysis/generate — retraitement
 * analytique. Fully deterministic, see financial-analysis.ts on the
 * backend: BFR here is tied to the tableau de flux's own ΔBFR by
 * construction, and trésorerie nette is asserted to reconcile — the
 * backend itself refuses (409) if either tie-out fails, so a successful
 * response here is already reconciled, not just computed.
 */
export interface FinancialAnalysisResult {
  sig: SigCascade;
  margins: Margins;
  bfr: BfrSnapshot;
  fondsDeRoulement: FondsDeRoulement;
  tresorerieNette: TresorerieNette;
  freeCashFlow: FreeCashFlow;
  endettementEtCapitaux: EndettementEtCapitaux;
  coutDeLaDette: CoutDeLaDette;
  ratios: Ratios;
}

/** A user-declared or computed réintégration/déduction line — see resultat-fiscal.ts on the backend. */
export interface ResultatFiscalLigne {
  code: string;
  label: string;
  montant: string;
}

/** A réintégration the ledger suggests but the caller must confirm — `suggested` never counts toward the total on its own, only `confirmed` does. */
export interface ConfirmableLigne {
  code: string;
  label: string;
  suggested: string;
  confirmed: string;
}

/**
 * Response shape for POST /resultat-fiscal/generate — détermination du
 * résultat fiscal (2058-A/2058-B cadre III). Categorically different
 * from every other liasse response type: this module guarantees its
 * own ARITHMETIC (résultat fiscal = resultatComptable + Σréintégrations
 * − Σdéductions, asserted server-side), never tax completeness — most
 * réintégrations/déductions are supplied by the caller as tax judgment
 * this app cannot derive. See resultat-fiscal.ts on the backend and
 * CLAUDE.md "Détermination du résultat fiscal (2058-A/2058-B)".
 */
export interface ResultatFiscalResult {
  /** = compte de résultat's own beneficeOuPerte, signed — négatif means déficit, never flipped. */
  resultatComptable: string;
  /** I7 — computed from compte 695 (HK), not declared. */
  impotSurLesSocietes: ResultatFiscalLigne;
  /** WJ (compte 6712), WG (compte 63514) — suggested from the ledger, confirmed by the caller. */
  reintegrationsConfirmables: ConfirmableLigne[];
  /** Every other réintégration, as declared (any 2058-A/2058-B code). */
  reintegrationsDeclarees: ResultatFiscalLigne[];
  /** WR — I7 + Σ confirmed réintégrations + Σ declared réintégrations. */
  totalReintegrations: string;
  /** Every déduction, as declared — includes 2058-B cadre III's WU when the caller declares it. */
  deductionsDeclarees: ResultatFiscalLigne[];
  /** XH — Σ declared déductions. */
  totalDeductions: string;
  /** XN/XO — resultatComptable + totalReintegrations − totalDeductions, signed. */
  resultatFiscal: string;
}

/**
 * AI chatbot (Phase 1, read-only) — see CLAUDE.md "AI chatbot". A
 * ChatMessage is the exact shape replayed to the local model on every
 * turn (see the backend's chat-orchestrator.service.ts): USER is what the
 * person typed, ASSISTANT is the model's reply (optionally carrying
 * toolCalls it wants executed before it can finish answering), TOOL is a
 * tool call's result fed back as the next turn. Rendering ASSISTANT's
 * toolCalls and the following TOOL row's content IS the tool-call trace —
 * the derivation-transparency requirement for this module.
 */
export type ChatMessageRole = 'USER' | 'ASSISTANT' | 'TOOL';

/**
 * Which port produced a message — see CLAUDE.md "AI chatbot cloud tier".
 * Every existing message, and every write path today, is LOCAL; CLOUD is
 * not yet reachable (no cloud engine is wired into the orchestrator yet).
 * This field exists now so the always-visible per-message indicator has
 * real, persisted state to render — see AssistantPage.tsx's EngineBadge.
 */
export type ChatEngine = 'LOCAL' | 'CLOUD';

/** The two cloud providers with verified, cited residency/DPA terms — see specs/ai-chatbot-cloud-tier-implementation-spec.md. An OpenAI-compatible custom-endpoint option is deliberately deferred. */
export type CloudProvider = 'CLAUDE' | 'DEEPSEEK';

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  /** Only present on an ASSISTANT message that requested tool calls. */
  toolCalls: ChatToolCall[] | null;
  /** Only present on a TOOL message — which tool produced this result. */
  toolName: string | null;
  toolCallId: string | null;
  /** Always LOCAL today — see the ChatEngine doc comment above. */
  engine: ChatEngine;
  /** Set only when engine is CLOUD. Null on every message today. */
  cloudProvider: CloudProvider | null;
  createdAt: string;
}

/**
 * Response shape for GET /ai-chat/cloud-credentials — never the real key,
 * only a masked hint (e.g. "sk-...ab12"). See CloudCredentialsService on
 * the backend: getDecryptedKey() (the one method that returns plaintext)
 * is not exposed by any controller at all.
 */
export interface CloudCredentialSummary {
  provider: CloudProvider;
  maskedKey: string;
  updatedAt: string;
}

export interface ChatSession {
  id: string;
  title: string | null;
  /**
   * Non-null while a bounded cloud-proposal thread is open on this session
   * — see CLAUDE.md "AI chatbot cloud tier" / "server-side thread
   * enforcement". Drives whether the composer shows "☁️ Continuer avec
   * [Provider]" + "🔒 Revenir au local" (thread open) or "☁️ Proposer avec
   * [Provider]" (no thread, gated on an attached file) — see
   * AssistantPage.tsx.
   */
  cloudProposalThreadId: string | null;
  /** Which provider `cloudProposalThreadId` is bound to. Null iff it is. */
  cloudProposalProvider: CloudProvider | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSessionWithMessages extends ChatSession {
  messages: ChatMessage[];
}

/**
 * GET /ai-chat/availability — whether a local model is reachable and
 * loaded right now. The chat UI polls this to show a clean degraded
 * state instead of letting a send attempt fail with a raw error.
 */
export interface LocalModelAvailability {
  available: boolean;
  detail: string;
}

/**
 * The tool result shape of propose_ecriture (AI chatbot Phase 2 — see
 * CLAUDE.md "AI chatbot Phase 2"). `dto` is a plain object shaped exactly
 * like CreateEcritureDto (imported as a type for the request side — this
 * is the RESPONSE shape, so it's hand-authored like every other response
 * type in this file) — AssistantPage sends it, possibly edited, straight
 * to the ordinary POST /entries endpoint via useCreateEcriture(). Nothing
 * here is ever auto-posted: `dto` existing in a chat message is not the
 * same as it existing in the ledger.
 */
export interface ProposedEcritureLigne {
  compteId: string;
  compteAuxId?: string;
  debit?: string;
  credit?: string;
  vatRateId?: string;
  dateEcheance?: string;
}

export interface ProposedEcritureDto {
  journalId: string;
  fiscalYearId: string;
  ecritureDate: string;
  pieceRef?: string;
  pieceDate?: string;
  libelle: string;
  lignes: ProposedEcritureLigne[];
}

export interface ProposedEcriture {
  dto: ProposedEcritureDto;
  /** Non-blocking compliance warnings (e.g. orphaned-immobilisation). */
  warnings: string[];
  /** Judgment calls the model made — surfaced, never silently decided. */
  assumptions: string[];
}

/**
 * A saved template for a repeating écriture — see CLAUDE.md "Recurring
 * entries / templates". `frequency`/`anchorDay`/`anchorMonth` are purely
 * informational (feed `nextDueDate`'s "prochaine échéance" hint) —
 * applying a template is always an explicit, on-demand action via
 * POST .../preview, never auto-posted on a schedule.
 */
export type RecurrenceFrequency = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface RecurringEntryTemplateLine {
  id: string;
  templateId: string;
  order: number;
  /** PCG account NUMBER (not id) — resolved to a live Account at apply-time. */
  accountNumber: string;
  auxAccountNumber: string | null;
  vatRateId: string | null;
  /** Money string, e.g. "1234.56". */
  debit: string;
  credit: string;
}

export interface RecurringEntryTemplate {
  id: string;
  companyId: string;
  name: string;
  journalId: string;
  libelle: string;
  frequency: RecurrenceFrequency | null;
  anchorDay: number | null;
  anchorMonth: number | null;
  /** Stamped by the explicit POST .../mark-applied call — not an audit trail. */
  lastAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: RecurringEntryTemplateLine[];
  /** Computed at read time from frequency/anchorDay/anchorMonth/lastAppliedAt — never stored. */
  nextDueDate: string | null;
}

/**
 * The response of POST .../preview — resolved but UNPERSISTED, same
 * "never persists" discipline as ProposedEcriture above. `dto` is saved
 * via the ordinary POST /entries (useCreateEcriture()), never a
 * privileged write path.
 */
export interface RecurringEntryApplicationPreview {
  dto: ProposedEcritureDto;
  warnings: string[];
}

/**
 * Response for POST /documents/suggest-accounts — the "Comptable IA"
 * toggle's own explicit action (see CLAUDE.md "Supporting-document
 * attachments" — Layer 3). Reuses the SAME ProposedEcriture shape
 * propose_ecriture already returns — one review discipline, not a
 * parallel one. `proposal` merges into EcritureEditor's own draft lines
 * on confirm; it never posts by itself.
 */
export interface DocumentAccountSuggestion {
  proposal: ProposedEcriture | null;
  message: string | null;
}

/**
 * The landing screen — see CLAUDE.md "Dashboard". Every figure here is
 * already computed and verified by an existing service (LiasseService,
 * FinancialAnalysisService, LedgerService); this page only arranges
 * them. `available: false` is a real, expected state (drafts pending,
 * no fiscal year, régime réel simplifié), not an error — render its
 * `reason` as a calm banner, never throw.
 */
export interface DashboardCaHistoryPoint {
  fiscalYearId: string;
  label: string;
  chiffreDAffaires: string;
}

export interface DashboardAssocieBalance {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  /** debit − credit. Positive = the associé owes the company; negative = the company owes the associé. */
  balance: string;
  /** True only for the flat 455000 collectif itself — lines never attributed to a named associé. */
  isUnattributed: boolean;
}

export interface DashboardRecentEntry {
  ecritureId: string;
  /** The écriture's own journal — lets the dashboard deep-link straight to this line's écriture in the journal grid. */
  journalId: string;
  ecritureDate: string;
  libelle: string;
  accountNumber: string;
  accountLabel: string;
  debit: string;
  credit: string;
  isValidated: boolean;
}

export interface DashboardSummaryAvailable {
  available: true;
  fiscalYear: { id: string; label: string };
  tresorerie: string;
  chiffreAffaires: string;
  dettesFournisseurs: string;
  encoursClient: string;
  revenus: string;
  depenses: string;
  /** SIG cascade's own resultatNet — reused directly, never revenus − dépenses re-derived on the frontend. */
  resultatNet: string;
  ebe: string;
  margeEbe: string | null;
  caHistory: DashboardCaHistoryPoint[];
  comptesCourantsAssocies: DashboardAssocieBalance[];
  recentBankEntries: DashboardRecentEntry[];
}

export interface DashboardSummaryUnavailable {
  available: false;
  reason: string;
}

export type DashboardSummary = DashboardSummaryAvailable | DashboardSummaryUnavailable;

/**
 * Bank reconciliation — see CLAUDE.md "Bank reconciliation". A real,
 * named bank account linked to one 512/514/516/517-family PCG account.
 */
export interface BankAccount {
  id: string;
  companyId: string;
  compteId: string;
  label: string;
  iban: string | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

/** Response for POST /bank-reconciliation/statements/preview — no persistence. */
export interface StatementPreviewLine {
  bookingDate: string;
  valueDate: string | null;
  /** Signed API-string — positive = inflow, negative = outflow. */
  amount: string;
  label: string;
  bankReference: string | null;
  isDuplicate: boolean;
}

export interface StatementPreviewResponse {
  iban: string | null;
  periodStart: string;
  periodEnd: string;
  /** Null for a CSV import — no balance oracle exists for that format. */
  openingBalance: string | null;
  closingBalance: string | null;
  lines: StatementPreviewLine[];
}

export interface BankStatementImport {
  id: string;
  companyId: string;
  bankAccountId: string;
  fileName: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: string | null;
  closingBalance: string | null;
  importedAt: string;
}

export interface CsvColumnsPreview {
  delimiter: string;
  headers: string[];
  sampleRows: string[][];
}

export type CsvDateFormat = 'DMY' | 'MDY' | 'YMD';
export type CsvDecimalSeparator = ',' | '.';

export interface CsvColumnMapping {
  dateColumn: string;
  labelColumn: string;
  amountColumn?: string;
  debitColumn?: string;
  creditColumn?: string;
  referenceColumn?: string;
  dateFormat: CsvDateFormat;
  decimalSeparator: CsvDecimalSeparator;
  delimiter?: string;
  invertSign?: boolean;
}

export type MatchConfidence = 'HIGH' | 'AMBIGUOUS' | 'NO_CANDIDATE';

export interface MatchCandidate {
  ecritureLigneId: string;
  ecritureId: string;
  ecritureNum: string | null;
  ecritureDate: string;
  libelle: string;
  amount: string;
  dateDistanceDays: number;
  labelSimilarity: number;
}

/** GET /bank-reconciliation/accounts/:id/proposals — recomputed fresh every call, never persisted. */
export interface StatementLineMatchProposal {
  statementLineId: string;
  confidence: MatchConfidence;
  candidates: MatchCandidate[];
}

export type BankStatementLineStatus = 'UNMATCHED' | 'CONFIRMED' | 'IGNORED';

export interface BankStatementLine {
  id: string;
  companyId: string;
  importId: string;
  bankAccountId: string;
  bookingDate: string;
  valueDate: string | null;
  amount: string;
  label: string;
  bankReference: string | null;
  status: BankStatementLineStatus;
  matchedLigneId: string | null;
  ignoredReason: string | null;
}

/**
 * Bank reconciliation — Layer 1b, live aggregator connectivity. See
 * CLAUDE.md "Bank reconciliation — Layer 1b". Bridge is the only
 * provider this pass ships — still a paper design against Bridge's
 * public docs, not yet verified against a real Bridge sandbox.
 */
export type BankAggregatorProvider = 'BRIDGE';
export type BankAggregatorLinkStatus = 'ACTIVE' | 'REVOKED' | 'ERROR';

/** Never carries the real access token — always a masked hint, same discipline as CloudCredentialSummary. */
export interface BankAggregatorLinkSummary {
  id: string;
  bankAccountId: string;
  provider: BankAggregatorProvider;
  maskedAccessToken: string;
  status: BankAggregatorLinkStatus;
  lastSyncedAt: string | null;
}

/**
 * Traceability drill-down, Tier 1 — see CLAUDE.md "Traceability
 * drill-down". Response for GET /liasse/bilan-line-trace and
 * /liasse/cdr-line-trace. `lineValue` is asserted server-side to equal
 * the sum of every account's own `contribution` — the oracle this
 * feature is built on; if the backend ever disagreed, it would throw
 * rather than return this shape at all.
 */
export interface TracedAccount {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  /** This account's own signed contribution to the line's total. */
  contribution: string;
}

export interface LineTraceResult {
  lineCode: string;
  lineLabel: string;
  lineValue: string;
  fiscalYearId: string;
  accounts: TracedAccount[];
}

/**
 * Traceability drill-down, Tier 2 — 2054/2055/2056 movement-table
 * traces. See CLAUDE.md "Traceability drill-down". Three genuinely
 * different détail shapes (FixedAsset-rooted, DepreciationEntry-
 * rooted, Account-rooted) — see each backend trace module's own doc
 * comment for why.
 */
export type Tableau2054TraceColumn = 'debut' | 'acquisitions' | 'cessions';
export type Tableau2055TraceColumn = 'debut' | 'dotations' | 'diminutions';
export type Tableau2056TraceColumn = 'debut' | 'dotations' | 'reprises';

export interface Tableau2054AssetTrace {
  assetId: string;
  assetLabel: string;
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  contribution: string;
}

export interface Tableau2054TraceResult {
  rowCode: string;
  rowLabel: string;
  column: Tableau2054TraceColumn;
  columnValue: string;
  fiscalYearId: string;
  /** False only for "debut" — see tableau-2054-trace.ts's own doc comment for why. */
  drillableToEcritures: boolean;
  assets: Tableau2054AssetTrace[];
}

export interface Tableau2055DetailTrace {
  assetId: string;
  assetLabel: string;
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  /** The real fiscal year this specific contribution's own écriture is dated in — may differ from the reported year for "debut". */
  fiscalYearId: string;
  contribution: string;
}

export interface Tableau2055TraceResult {
  categoryCode: string;
  categoryLabel: string;
  column: Tableau2055TraceColumn;
  columnValue: string;
  details: Tableau2055DetailTrace[];
}

export interface Tableau2056AccountTrace {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  contribution: string;
}

export interface Tableau2056TraceResult {
  categoryCode: string;
  categoryLabel: string;
  column: Tableau2056TraceColumn;
  columnValue: string;
  fiscalYearId: string;
  accounts: Tableau2056AccountTrace[];
}

/**
 * Traceability drill-down, Tier 3 — CA3 rate lines, 2058 WJ/WG, and
 * 2059-A. See CLAUDE.md "Traceability drill-down".
 */
export type Ca3TraceColumn = 'baseHT' | 'taxe';

export interface Ca3AccountTrace {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  contribution: string;
}

export interface Ca3LineTraceResult {
  ligne: string;
  label: string;
  column: Ca3TraceColumn;
  columnValue: string;
  accounts: Ca3AccountTrace[];
}

export type ResultatFiscalTraceCode = 'WJ' | 'WG';

export interface ResultatFiscalTracedAccount {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  contribution: string;
}

export interface ResultatFiscalLineTraceResult {
  code: string;
  label: string;
  fiscalYearId: string;
  columnValue: string;
  accounts: ResultatFiscalTracedAccount[];
}

export type Tableau2059TraceColumn = 'valeurOrigine' | 'amortissements' | 'prixDeVente';

export interface Tableau2059TraceResult {
  assetId: string;
  assetLabel: string;
  column: Tableau2059TraceColumn;
  columnValue: string;
  fiscalYearId: string;
  accountId: string;
  accountNumber: string;
  accountLabel: string;
}

/**
 * Invoicing — Phase A. See CLAUDE.md "Invoicing — Phase A" and
 * "Invoicing — Factur-X rendering". A DRAFT invoice is freely editable
 * and jurisdiction-agnostic; finalize() (France only — Monaco throws)
 * assigns invoiceNumber, snapshots the client's legal-mention fields,
 * and posts a real balanced écriture.
 */
export type InvoiceType = 'SALE' | 'CREDIT_NOTE';
export type InvoiceStatus = 'DRAFT' | 'FINALIZED';

export interface InvoiceLine {
  id: string;
  companyId: string;
  invoiceId: string;
  description: string;
  /** Decimal string, same shape as a money string — see lib/money.ts. */
  quantity: string;
  /** Money string, e.g. "1234.56". */
  unitPriceHT: string;
  revenueAccountId: string;
  vatRateId: string | null;
}

export interface Invoice {
  id: string;
  companyId: string;
  fiscalYearId: string;
  type: InvoiceType;
  status: InvoiceStatus;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  clientAccountId: string;
  clientNameSnapshot: string | null;
  clientAddressLineSnapshot: string | null;
  clientPostalCodeSnapshot: string | null;
  clientCitySnapshot: string | null;
  /** ISO 3166-1 alpha-2 code (e.g. "FR"), not a display name. */
  clientCountrySnapshot: string | null;
  clientSirenOrRci: string | null;
  clientVatNumber: string | null;
  correctsInvoiceId: string | null;
  postedEcritureId: string | null;
  /** TVA sur les encaissements (CGI art. 269) — see CLAUDE.md "Invoicing — cash-basis VAT".
   *  Null until "Marquer comme encaissée" reclassifies the invoice's suspense VAT. */
  encaissementConfirmedAt: string | null;
  encaissementEcritureId: string | null;
  createdAt: string;
  updatedAt: string;
  lines: InvoiceLine[];
}

export interface FinalizeInvoiceResult {
  invoice: Invoice;
  mentions: InvoiceMentions;
}

export interface InvoiceMentionsAddress {
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  countryCode: string;
}

export interface InvoiceMentionsPartyIdentity {
  name: string;
  address: InvoiceMentionsAddress;
  formattedAddress: string;
  vatNumber: string | null;
  sirenOrRci: string | null;
}

export interface InvoiceMentionsLine {
  description: string;
  quantity: string;
  unitPriceHT: string;
  totalHT: string;
  vatRatePercent: string | null;
}

export interface InvoiceMentionsVatBreakdown {
  ratePercent: string;
  baseHT: string;
  vatAmount: string;
}

/** FACTURE/AVOIR are real fiscal documents; DEVIS is a quote (no legal numbering, no
 *  L441-10 notices) — see CLAUDE.md "Invoicing — devis (quote) PDF". */
export type InvoiceDocumentKind = 'FACTURE' | 'AVOIR' | 'DEVIS';

export interface InvoicePaymentInstructions {
  bankName: string;
  iban: string;
  bic: string;
}

/** The mandatory-mentions data for a FINALIZED invoice, or the priced content of a
 *  DEVIS — CGI 242 nonies A + Code de commerce L441-10. */
export interface InvoiceMentions {
  jurisdiction: 'FR';
  documentKind: InvoiceDocumentKind;
  /** Empty string for a DEVIS. */
  invoiceNumber: string;
  invoiceDate: string;
  isCreditNote: boolean;
  correctsInvoiceNumber: string | null;
  seller: InvoiceMentionsPartyIdentity;
  buyer: InvoiceMentionsPartyIdentity;
  lines: InvoiceMentionsLine[];
  vatByRate: InvoiceMentionsVatBreakdown[];
  totalHT: string;
  totalVAT: string;
  totalTTC: string;
  latePaymentPenaltyNotice: string;
  forfeitIndemnityNotice: string;
  escompteNotice: string;
  paymentInstructions: InvoicePaymentInstructions | null;
}

/**
 * Anomaly surfacing — see CLAUDE.md "Anomaly surfacing". Gentle,
 * non-blocking flags, computed fresh on every request, never persisted,
 * never gating anything.
 */
export interface SpendingAnomaly {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  /** YYYY-MM */
  month: string;
  currentAmount: string;
  trailingAverage: string;
  /** A dimensionless ratio, e.g. "2.43" — not a money string. */
  multiplier: string;
  monthsOfHistory: number;
}

export type PaymentMatchTier = 'HIGH' | 'AMBIGUOUS' | 'NONE';

export interface PaymentMatchCandidate {
  statementLineId: string;
  amount: string;
  bookingDate: string;
  bankAccountLabel: string;
  dateDistanceDays: number;
}

export interface PaymentAnomaly {
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  totalTTC: string;
  invoiceDate: string;
  daysOverdue: number;
  matchTier: PaymentMatchTier;
  candidates: PaymentMatchCandidate[];
}

export interface AnomaliesSummary {
  spending: SpendingAnomaly[];
  payments: PaymentAnomaly[];
}

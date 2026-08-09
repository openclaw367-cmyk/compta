import { Prisma } from '@prisma/client';
import { LiasseLigne } from './trial-balance-engine';

/**
 * Shared hand-computed oracle dataset for the 2050-series pass — see
 * bilan-2050.spec.ts, compte-resultat-2052-2053.spec.ts, and
 * liasse-articulation.spec.ts, all of which assert against this same
 * scenario so the bilan, compte de résultat, and articulation checks
 * stay mutually consistent. Not a *.spec.ts itself (no test runner
 * picks it up), just the fixture.
 *
 * Built as a sequence of individually-balanced transactions (each
 * comment's débit total equals its crédit total) so the *whole* dataset
 * is a valid double-entry ledger by construction — Actif = Passif is
 * therefore a real assertion about the mapping code, not something
 * guaranteed by how the fixture happens to be built.
 *
 * Deliberately exercises: immobilisations + amortissements (AN/AP/AT),
 * stocks (BT), clients/fournisseurs (BX/DX/DZ), capitaux propres
 * (DA/DD/DH), a provision (DP), the two confirmed high-risk
 * regroupings — bank overdraft sign-reclassification (514000 ends net
 * credit → DU, not netted against CF) and the personnel "charges à
 * payer" dual-nature routing (428000 ends net credit → DY) — a full
 * compte de résultat (exploitation, financier, exceptionnel, impôts)
 * ending in a loss, and TVA collectée (445710) landing correctly on
 * DY. Cessions (F1/G1/G2/G3, the 775/675 split) are untouched, so they
 * correctly compute to 0.00 — not tested further here since that's
 * already the documented, expected behavior (spec §4.3).
 */
function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

interface RawLine {
  compteNumber: string;
  pcgClass: number;
  debit: string;
  credit: string;
}

const RAW_LINES: RawLine[] = [
  // T1 — apport de capital en numéraire
  { compteNumber: '512000', pcgClass: 5, debit: '120000.00', credit: '0.00' },
  { compteNumber: '101000', pcgClass: 1, debit: '0.00', credit: '120000.00' },
  // T2 — emprunt bancaire
  { compteNumber: '512000', pcgClass: 5, debit: '40000.00', credit: '0.00' },
  { compteNumber: '164000', pcgClass: 1, debit: '0.00', credit: '40000.00' },
  // T3 — achat d'un terrain, comptant
  { compteNumber: '211000', pcgClass: 2, debit: '30000.00', credit: '0.00' },
  { compteNumber: '512000', pcgClass: 5, debit: '0.00', credit: '30000.00' },
  // T4 — achat d'une construction, partiellement à crédit
  { compteNumber: '213000', pcgClass: 2, debit: '100000.00', credit: '0.00' },
  { compteNumber: '512000', pcgClass: 5, debit: '0.00', credit: '60000.00' },
  { compteNumber: '404000', pcgClass: 4, debit: '0.00', credit: '40000.00' },
  // T5 — achat de matériel de bureau/informatique, comptant
  { compteNumber: '218300', pcgClass: 2, debit: '12000.00', credit: '0.00' },
  { compteNumber: '512000', pcgClass: 5, debit: '0.00', credit: '12000.00' },
  // T6 — dotations aux amortissements (construction + matériel)
  { compteNumber: '681100', pcgClass: 6, debit: '8000.00', credit: '0.00' },
  { compteNumber: '281300', pcgClass: 2, debit: '0.00', credit: '5000.00' },
  { compteNumber: '281800', pcgClass: 2, debit: '0.00', credit: '3000.00' },
  // T7 — achat de marchandises en stock, à crédit
  { compteNumber: '370000', pcgClass: 3, debit: '18000.00', credit: '0.00' },
  { compteNumber: '401000', pcgClass: 4, debit: '0.00', credit: '18000.00' },
  // T8 — achat de matières premières, à crédit
  { compteNumber: '601000', pcgClass: 6, debit: '9000.00', credit: '0.00' },
  { compteNumber: '401000', pcgClass: 4, debit: '0.00', credit: '9000.00' },
  // T9 — vente de marchandises, TVA 20%, à crédit
  { compteNumber: '411000', pcgClass: 4, debit: '36000.00', credit: '0.00' },
  { compteNumber: '707000', pcgClass: 7, debit: '0.00', credit: '30000.00' },
  { compteNumber: '445710', pcgClass: 4, debit: '0.00', credit: '6000.00' },
  // T10 — encaissement partiel des clients
  { compteNumber: '512000', pcgClass: 5, debit: '21000.00', credit: '0.00' },
  { compteNumber: '411000', pcgClass: 4, debit: '0.00', credit: '21000.00' },
  // T11 — règlement partiel des fournisseurs
  { compteNumber: '401000', pcgClass: 4, debit: '17000.00', credit: '0.00' },
  { compteNumber: '512000', pcgClass: 5, debit: '0.00', credit: '17000.00' },
  // T12 — charges externes diverses, comptant
  { compteNumber: '613000', pcgClass: 6, debit: '6000.00', credit: '0.00' },
  { compteNumber: '616000', pcgClass: 6, debit: '2000.00', credit: '0.00' },
  { compteNumber: '622600', pcgClass: 6, debit: '3000.00', credit: '0.00' },
  { compteNumber: '512000', pcgClass: 5, debit: '0.00', credit: '11000.00' },
  // T13 — salaires et cotisations sociales, partiellement payés
  { compteNumber: '641000', pcgClass: 6, debit: '20000.00', credit: '0.00' },
  { compteNumber: '645000', pcgClass: 6, debit: '8000.00', credit: '0.00' },
  { compteNumber: '512000', pcgClass: 5, debit: '0.00', credit: '22000.00' },
  { compteNumber: '431000', pcgClass: 4, debit: '0.00', credit: '6000.00' },
  // T14 — produits financiers (revenus de VMP) reçus
  { compteNumber: '512000', pcgClass: 5, debit: '900.00', credit: '0.00' },
  { compteNumber: '764000', pcgClass: 7, debit: '0.00', credit: '900.00' },
  // T15 — charges financières (intérêts d'emprunt) payées
  { compteNumber: '661000', pcgClass: 6, debit: '1200.00', credit: '0.00' },
  { compteNumber: '512000', pcgClass: 5, debit: '0.00', credit: '1200.00' },
  // T16 — produit exceptionnel reçu
  { compteNumber: '512000', pcgClass: 5, debit: '500.00', credit: '0.00' },
  { compteNumber: '771000', pcgClass: 7, debit: '0.00', credit: '500.00' },
  // T17 — charge exceptionnelle payée
  { compteNumber: '671000', pcgClass: 6, debit: '300.00', credit: '0.00' },
  { compteNumber: '512000', pcgClass: 5, debit: '0.00', credit: '300.00' },
  // T18 — impôt sur les bénéfices, dû mais non payé
  { compteNumber: '695000', pcgClass: 6, debit: '4000.00', credit: '0.00' },
  { compteNumber: '444000', pcgClass: 4, debit: '0.00', credit: '4000.00' },
  // T19 — report à nouveau créditeur existant
  { compteNumber: '512000', pcgClass: 5, debit: '3000.00', credit: '0.00' },
  { compteNumber: '110000', pcgClass: 1, debit: '0.00', credit: '3000.00' },
  // T20 — réserve légale existante
  { compteNumber: '512000', pcgClass: 5, debit: '2000.00', credit: '0.00' },
  { compteNumber: '106100', pcgClass: 1, debit: '0.00', credit: '2000.00' },
  // T21 — dotation aux provisions pour risques (litige)
  { compteNumber: '681500', pcgClass: 6, debit: '5000.00', credit: '0.00' },
  { compteNumber: '151100', pcgClass: 1, debit: '0.00', credit: '5000.00' },
  // T22 — charges de personnel à payer (accrual), non payées — exercises the 428 dual-nature route
  { compteNumber: '641000', pcgClass: 6, debit: '1000.00', credit: '0.00' },
  { compteNumber: '428000', pcgClass: 4, debit: '0.00', credit: '1000.00' },
  // T23 — règlement fournisseur via un second compte bancaire qui passe à découvert —
  // exercises the overdraft sign-reclassification (514000 ends net credit, routes to DU)
  { compteNumber: '401000', pcgClass: 4, debit: '3000.00', credit: '0.00' },
  { compteNumber: '514000', pcgClass: 5, debit: '0.00', credit: '3000.00' },
];

const ALL_LIGNES: LiasseLigne[] = RAW_LINES.map((line) => ({
  compteNumber: line.compteNumber,
  pcgClass: line.pcgClass,
  debit: d(line.debit),
  credit: d(line.credit),
}));

export const ORACLE_BILAN_LIGNES: LiasseLigne[] = ALL_LIGNES.filter(
  (l) => l.pcgClass >= 1 && l.pcgClass <= 5,
);
export const ORACLE_CDR_LIGNES: LiasseLigne[] = ALL_LIGNES.filter(
  (l) => l.pcgClass === 6 || l.pcgClass === 7,
);

/** HN, hand-computed — see the module doc comment and the spec files for the full derivation. */
export const ORACLE_HN = '-36100.00';

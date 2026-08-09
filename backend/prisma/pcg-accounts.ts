import { JournalType } from '@prisma/client';

/**
 * Base chart of accounts — the "comptes principaux" most commonly used in
 * practice, drawn from Règlement ANC 2014-03 Art. 932-1 (see
 * specs/Reglt 2014-03_Plan comptable general.pdf). Deliberately not the
 * full official nomenclature, which runs to several hundred entries;
 * additional accounts can be created through the accounts API as needed.
 *
 * Shared between seed.ts (FR demo company) and seed-monaco.ts (MC demo
 * company) unchanged — including the three VAT accounts (445660, 445662,
 * 445710). Per the confirmed account model (see
 * specs/vat-monaco-implementation-spec.md §5): Monaco's ligne 44/45
 * labels are verbatim identical to France's ligne 19/20, and accounts are
 * already company-scoped, so a Monaco company reuses the same numbers and
 * labels rather than a parallel-but-different numbering scheme. If a
 * genuine Monaco-specific account is ever needed (e.g. for "TMP" — see
 * the spec's open items), add it in seed-monaco.ts, not here.
 */
export const PCG_ACCOUNTS: readonly { number: string; label: string }[] = [
  // Classe 1 — Comptes de capitaux
  { number: '101000', label: 'Capital' },
  { number: '104000', label: "Primes liées au capital social" },
  { number: '106100', label: 'Réserve légale' },
  { number: '106800', label: 'Autres réserves' },
  { number: '110000', label: 'Report à nouveau (solde créditeur)' },
  { number: '119000', label: 'Report à nouveau (solde débiteur)' },
  { number: '120000', label: "Résultat de l'exercice (bénéfice)" },
  { number: '129000', label: "Résultat de l'exercice (perte)" },
  { number: '164000', label: 'Emprunts auprès des établissements de crédit' },
  { number: '168800', label: 'Intérêts courus sur emprunts et dettes' },

  // Classe 2 — Comptes d'immobilisations
  { number: '201000', label: "Frais d'établissement" },
  { number: '205000', label: 'Concessions, brevets, licences, marques, logiciels' },
  { number: '206000', label: 'Droit au bail' },
  { number: '207000', label: 'Fonds commercial' },
  { number: '211000', label: 'Terrains' },
  { number: '213000', label: 'Constructions' },
  { number: '215400', label: 'Matériel industriel' },
  { number: '218100', label: 'Installations générales, agencements, aménagements divers' },
  { number: '218200', label: 'Matériel de transport' },
  { number: '218300', label: 'Matériel de bureau et matériel informatique' },
  { number: '218400', label: 'Mobilier' },
  { number: '231000', label: 'Immobilisations corporelles en cours' },
  { number: '261000', label: 'Titres de participation' },
  { number: '280500', label: 'Amortissements des concessions, brevets, licences, logiciels' },
  { number: '281300', label: 'Amortissements des constructions' },
  { number: '281540', label: 'Amortissements du matériel industriel' },
  { number: '281800', label: 'Amortissements des autres immobilisations corporelles' },

  // Classe 3 — Comptes de stocks et en-cours
  { number: '355000', label: 'Produits finis' },
  { number: '370000', label: 'Marchandises' },

  // Classe 4 — Comptes de tiers
  { number: '401000', label: 'Fournisseurs' },
  { number: '403000', label: 'Fournisseurs - Effets à payer' },
  { number: '404000', label: "Fournisseurs d'immobilisations" },
  { number: '408000', label: 'Fournisseurs - Factures non parvenues' },
  { number: '409000', label: 'Fournisseurs débiteurs' },
  { number: '411000', label: 'Clients' },
  { number: '413000', label: 'Clients - Effets à recevoir' },
  { number: '416000', label: 'Clients douteux ou litigieux' },
  { number: '418000', label: 'Clients - Produits non encore facturés' },
  { number: '419000', label: 'Clients créditeurs' },
  { number: '421000', label: 'Personnel - Rémunérations dues' },
  { number: '425000', label: 'Personnel - Avances et acomptes' },
  { number: '427000', label: 'Personnel - Oppositions' },
  { number: '428000', label: 'Personnel - Charges à payer et produits à recevoir' },
  { number: '431000', label: 'Sécurité sociale' },
  { number: '437000', label: 'Autres organismes sociaux' },
  { number: '444000', label: 'État - Impôts sur les bénéfices' },
  { number: '445660', label: 'TVA déductible sur autres biens et services' },
  { number: '445662', label: 'TVA déductible sur immobilisations' },
  { number: '445710', label: 'TVA collectée' },
  { number: '447000', label: 'Autres impôts, taxes et versements assimilés' },
  { number: '455000', label: 'Associés - Comptes courants' },
  { number: '486000', label: "Charges constatées d'avance" },
  { number: '487000', label: "Produits constatés d'avance" },

  // Classe 5 — Comptes financiers
  { number: '512000', label: 'Banques' },
  { number: '514000', label: 'Chèques postaux' },
  { number: '530000', label: 'Caisse' },
  { number: '580000', label: 'Virements internes' },

  // Classe 6 — Comptes de charges
  { number: '601000', label: 'Achats stockés - Matières premières (et fournitures)' },
  { number: '602000', label: 'Achats stockés - Autres approvisionnements' },
  { number: '606100', label: 'Fournitures non stockables (eau, énergie, ...)' },
  { number: '606300', label: "Fournitures d'entretien et de petit équipement" },
  { number: '606400', label: 'Fournitures administratives' },
  { number: '607000', label: 'Achats de marchandises' },
  { number: '611000', label: 'Sous-traitance générale' },
  { number: '613000', label: 'Locations' },
  { number: '615000', label: 'Entretien et réparations' },
  { number: '616000', label: "Primes d'assurances" },
  { number: '618000', label: 'Divers (documentation, colloques, ...)' },
  { number: '621000', label: "Personnel extérieur à l'entreprise" },
  { number: '622600', label: 'Honoraires' },
  { number: '623000', label: 'Publicité, publications, relations publiques' },
  { number: '625000', label: 'Déplacements, missions et réceptions' },
  { number: '626000', label: 'Frais postaux et de télécommunications' },
  { number: '627000', label: 'Services bancaires et assimilés' },
  { number: '635110', label: 'Contribution économique territoriale' },
  { number: '641000', label: 'Salaires et traitements' },
  { number: '645000', label: 'Charges de sécurité sociale et de prévoyance' },
  { number: '651000', label: 'Redevances pour concessions, brevets, licences' },
  { number: '661000', label: "Charges d'intérêts" },
  { number: '666000', label: 'Pertes de change' },
  { number: '671000', label: 'Charges exceptionnelles sur opérations de gestion' },
  { number: '681100', label: 'Dotations aux amortissements sur immobilisations' },
  { number: '695000', label: 'Impôts sur les bénéfices' },

  // Classe 7 — Comptes de produits
  { number: '701000', label: 'Ventes de produits finis' },
  { number: '706000', label: 'Prestations de services' },
  { number: '707000', label: 'Ventes de marchandises' },
  { number: '708000', label: 'Produits des activités annexes' },
  { number: '709000', label: 'Rabais, remises et ristournes accordés' },
  { number: '740000', label: "Subventions d'exploitation" },
  { number: '758000', label: 'Produits divers de gestion courante' },
  { number: '761000', label: 'Produits de participations' },
  { number: '764000', label: 'Revenus des valeurs mobilières de placement' },
  { number: '765000', label: 'Escomptes obtenus' },
  { number: '766000', label: 'Gains de change' },
  { number: '771000', label: 'Produits exceptionnels sur opérations de gestion' },
  { number: '775000', label: "Produits des cessions d'éléments d'actif" },
  { number: '777000', label: "Quote-part des subventions d'investissement virée au résultat" },
  { number: '781000', label: 'Reprises sur amortissements, dépréciations et provisions' },
];

/** Standard journals — same five for any company regardless of jurisdiction. */
export const JOURNALS: readonly { code: string; label: string; type: JournalType }[] = [
  { code: 'AC', label: 'Journal des achats', type: JournalType.ACHATS },
  { code: 'VE', label: 'Journal des ventes', type: JournalType.VENTES },
  { code: 'BQ', label: 'Journal de banque', type: JournalType.BANQUE },
  { code: 'OD', label: 'Journal des opérations diverses', type: JournalType.OPERATIONS_DIVERSES },
  { code: 'AN', label: 'Journal des à-nouveaux', type: JournalType.A_NOUVEAU },
];

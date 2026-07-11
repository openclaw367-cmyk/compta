import { FEC_COLUMNS } from './fec-format';

/**
 * Hardcoded independently of the FEC_COLUMNS export so an accidental edit
 * to the column order trips this test rather than silently drifting. The
 * order is fixed by Article A47 A-1 du LPF (1° et 2° du VII, 3° à 8° du
 * VIII) — re-verify against the primary legal text in specs/ (not the
 * BOI-CF-IOR-60-40-20 commentary, whose own illustrative tables use
 * inconsistent orderings from example to example) before changing this.
 */
const ARTICLE_A47_A1_COLUMN_ORDER = [
  'JournalCode',
  'JournalLib',
  'EcritureNum',
  'EcritureDate',
  'CompteNum',
  'CompteLib',
  'CompAuxNum',
  'CompAuxLib',
  'PieceRef',
  'PieceDate',
  'EcritureLib',
  'Debit',
  'Credit',
  'EcritureLet',
  'DateLet',
  'ValidDate',
  'Montantdevise',
  'Idevise',
];

describe('FEC_COLUMNS', () => {
  it('matches the Article A47 A-1 du LPF column order exactly', () => {
    expect(FEC_COLUMNS).toEqual(ARTICLE_A47_A1_COLUMN_ORDER);
  });

  it('has exactly 18 columns', () => {
    expect(FEC_COLUMNS).toHaveLength(18);
  });

  it('has no duplicate column names', () => {
    expect(new Set(FEC_COLUMNS).size).toBe(FEC_COLUMNS.length);
  });
});

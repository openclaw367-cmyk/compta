import {
  CandidateLigne,
  MatchableStatementLine,
  matchStatementLine,
  DATE_WINDOW_DAYS,
} from './matching-engine';

function ligne(overrides: Partial<CandidateLigne> = {}): CandidateLigne {
  return {
    id: 'ligne-1',
    ecritureId: 'ecriture-1',
    ecritureNum: null,
    ecritureDate: new Date('2026-03-05'),
    libelle: 'Achat fournitures',
    debit: '0.00',
    credit: '0.00',
    ...overrides,
  };
}

function statementLine(overrides: Partial<MatchableStatementLine> = {}): MatchableStatementLine {
  return {
    id: 'stmt-1',
    bookingDate: new Date('2026-03-05'),
    amount: '100.00',
    label: 'PRLV FOURNISSEUR',
    ...overrides,
  };
}

describe('matchStatementLine — hand-traced oracle', () => {
  it('HIGH confidence: exactly one candidate with the exact eligible amount and direction, same day', () => {
    const candidate = ligne({ id: 'l1', debit: '100.00' });
    const result = matchStatementLine(statementLine({ amount: '100.00' }), [candidate]);
    expect(result.confidence).toBe('HIGH');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].ecritureLigneId).toBe('l1');
    expect(result.candidates[0].dateDistanceDays).toBe(0);
  });

  it('a negative (outflow) statement amount matches the CREDIT side of a candidate, not debit', () => {
    const debitCandidate = ligne({ id: 'wrong-side', debit: '100.00' });
    const creditCandidate = ligne({ id: 'right-side', credit: '100.00' });
    const result = matchStatementLine(statementLine({ amount: '-100.00' }), [
      debitCandidate,
      creditCandidate,
    ]);
    expect(result.confidence).toBe('HIGH');
    expect(result.candidates[0].ecritureLigneId).toBe('right-side');
  });

  it('NO_CANDIDATE: no eligible candidate at all (wrong amount)', () => {
    const candidate = ligne({ debit: '50.00' });
    const result = matchStatementLine(statementLine({ amount: '100.00' }), [candidate]);
    expect(result.confidence).toBe('NO_CANDIDATE');
    expect(result.candidates).toHaveLength(0);
  });

  it('NO_CANDIDATE: correct amount but outside the date window is excluded entirely', () => {
    const farCandidate = ligne({
      debit: '100.00',
      ecritureDate: new Date('2026-03-05'),
    });
    const stmt = statementLine({
      amount: '100.00',
      bookingDate: new Date('2026-03-05'),
    });
    // Push the candidate's own date beyond the window relative to the statement line.
    const outOfWindow = { ...farCandidate, ecritureDate: new Date('2026-04-01') }; // 27 days > 15
    const result = matchStatementLine(stmt, [outOfWindow]);
    expect(result.confidence).toBe('NO_CANDIDATE');
  });

  it('exactly at the date window boundary is still eligible (inclusive)', () => {
    const boundaryDate = new Date('2026-03-05');
    boundaryDate.setDate(boundaryDate.getDate() + DATE_WINDOW_DAYS);
    const candidate = ligne({ id: 'boundary', debit: '100.00', ecritureDate: boundaryDate });
    const result = matchStatementLine(
      statementLine({ amount: '100.00', bookingDate: new Date('2026-03-05') }),
      [candidate],
    );
    expect(result.confidence).toBe('HIGH');
    expect(result.candidates[0].dateDistanceDays).toBe(DATE_WINDOW_DAYS);
  });

  it('one day beyond the window boundary is excluded', () => {
    const beyondDate = new Date('2026-03-05');
    beyondDate.setDate(beyondDate.getDate() + DATE_WINDOW_DAYS + 1);
    const candidate = ligne({ debit: '100.00', ecritureDate: beyondDate });
    const result = matchStatementLine(
      statementLine({ amount: '100.00', bookingDate: new Date('2026-03-05') }),
      [candidate],
    );
    expect(result.confidence).toBe('NO_CANDIDATE');
  });

  it('AMBIGUOUS: two candidates with the same eligible amount, ranked by date proximity (closest first)', () => {
    const closer = ligne({ id: 'closer', debit: '100.00', ecritureDate: new Date('2026-03-06') });
    const farther = ligne({ id: 'farther', debit: '100.00', ecritureDate: new Date('2026-03-12') });
    const result = matchStatementLine(
      statementLine({ amount: '100.00', bookingDate: new Date('2026-03-05') }),
      [farther, closer],
    );
    expect(result.confidence).toBe('AMBIGUOUS');
    expect(result.candidates.map((c) => c.ecritureLigneId)).toEqual(['closer', 'farther']);
    expect(result.candidates[0].dateDistanceDays).toBe(1);
    expect(result.candidates[1].dateDistanceDays).toBe(7);
  });

  it('AMBIGUOUS: same date distance breaks the tie by label similarity (higher first)', () => {
    const similar = ligne({
      id: 'similar',
      debit: '100.00',
      ecritureDate: new Date('2026-03-05'),
      libelle: 'Prélèvement fournisseur EDF',
    });
    const dissimilar = ligne({
      id: 'dissimilar',
      debit: '100.00',
      ecritureDate: new Date('2026-03-05'),
      libelle: 'Achat matériel bureau',
    });
    const result = matchStatementLine(
      statementLine({
        amount: '100.00',
        bookingDate: new Date('2026-03-05'),
        label: 'PRLV FOURNISSEUR EDF',
      }),
      [dissimilar, similar],
    );
    expect(result.confidence).toBe('AMBIGUOUS');
    expect(result.candidates[0].ecritureLigneId).toBe('similar');
    expect(result.candidates[0].labelSimilarity).toBeGreaterThan(
      result.candidates[1].labelSimilarity,
    );
  });

  it('a ligne with a zero debit/credit on the relevant side is never eligible, even at the exact amount elsewhere', () => {
    // e.g. a ligne that has 100.00 on CREDIT only, tested against an INFLOW (debit-seeking) statement amount.
    const creditOnly = ligne({ debit: '0.00', credit: '100.00' });
    const result = matchStatementLine(statementLine({ amount: '100.00' }), [creditOnly]);
    expect(result.confidence).toBe('NO_CANDIDATE');
  });
});

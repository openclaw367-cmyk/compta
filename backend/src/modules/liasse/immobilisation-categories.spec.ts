import { resolveImmobilisationCategory } from './immobilisation-categories';

describe('resolveImmobilisationCategory', () => {
  it('routes a bare 213 account to "sur sol propre" — the documented default', () => {
    expect(resolveImmobilisationCategory('213000').code).toBe('CONSTRUCTIONS_SOL_PROPRE');
  });

  it('routes a specific 2135 sub-account to "installations générales" instead of the default, via longest-prefix-match', () => {
    expect(resolveImmobilisationCategory('213500').code).toBe('CONSTRUCTIONS_INST_GENERALES');
  });

  it('routes 214 (a distinct top-level account, not a sub-code) to "sur sol d\'autrui"', () => {
    expect(resolveImmobilisationCategory('214000').code).toBe('CONSTRUCTIONS_SOL_AUTRUI');
  });

  it('routes the four "autres corporelles" sub-accounts to their own distinct categories', () => {
    expect(resolveImmobilisationCategory('218100').code).toBe('AUTRES_CORP_INST_GENERALES');
    expect(resolveImmobilisationCategory('218200').code).toBe('AUTRES_CORP_MATERIEL_TRANSPORT');
    expect(resolveImmobilisationCategory('218300').code).toBe('AUTRES_CORP_MATERIEL_BUREAU');
    expect(resolveImmobilisationCategory('218400').code).toBe('AUTRES_CORP_MATERIEL_BUREAU'); // 2184 folds into the same 2054/2055 row as 2183
    expect(resolveImmobilisationCategory('218600').code).toBe('AUTRES_CORP_EMBALLAGES');
  });

  it('folds fonds commercial (207) into its own category, distinct from other incorporelles (208)', () => {
    expect(resolveImmobilisationCategory('207000').code).toBe('FONDS_COMMERCIAL');
    expect(resolveImmobilisationCategory('208000').code).toBe('AUTRES_INCORPORELLES');
  });

  it('throws for a bare 218 account with no recognized sub-code — no generic fallback exists for autres corporelles', () => {
    expect(() => resolveImmobilisationCategory('218000')).toThrow(
      /no 2054\/2055 immobilisation category mapping/,
    );
  });

  it('throws for an account outside any known immobilisation prefix', () => {
    expect(() => resolveImmobilisationCategory('411000')).toThrow(
      /no 2054\/2055 immobilisation category mapping/,
    );
  });
});

import { resolveProvisionCategory } from './provision-categories';

describe('resolveProvisionCategory', () => {
  it('routes a specific 1511 sub-account to "litiges" instead of the bare-151 default, via longest-prefix-match', () => {
    expect(resolveProvisionCategory('151100').code).toBe('LITIGES');
    expect(resolveProvisionCategory('151200').code).toBe('GARANTIES_CLIENTS');
  });

  it('routes an unenumerated 151 sub-account (e.g. 1518 "autres provisions pour risques") to the bare-151 default', () => {
    expect(resolveProvisionCategory('151800').code).toBe('AUTRES_RISQUES_CHARGES');
    expect(resolveProvisionCategory('151300').code).toBe('AUTRES_RISQUES_CHARGES'); // 1513, pertes sur marchés à terme
  });

  it('routes a specific 1572 sub-account to "gros entretien" instead of the bare-157 default', () => {
    expect(resolveProvisionCategory('157200').code).toBe('GROS_ENTRETIEN');
    expect(resolveProvisionCategory('157100').code).toBe('AUTRES_RISQUES_CHARGES');
  });

  it('folds 1432 (fluctuation des cours) into the same "hausse des prix" row as 1431 — the CERFA form prints only one row for both', () => {
    expect(resolveProvisionCategory('143100').code).toBe('HAUSSE_PRIX');
    expect(resolveProvisionCategory('143200').code).toBe('HAUSSE_PRIX');
  });

  it('folds 144/146/147/148 (no dedicated CERFA row) into "autres provisions réglementées"', () => {
    expect(resolveProvisionCategory('144000').code).toBe('AUTRES_REGLEMENTEES');
    expect(resolveProvisionCategory('146000').code).toBe('AUTRES_REGLEMENTEES');
    expect(resolveProvisionCategory('147000').code).toBe('AUTRES_REGLEMENTEES');
    expect(resolveProvisionCategory('148000').code).toBe('AUTRES_REGLEMENTEES');
  });

  it('routes 491 (clients) separately from the bare-49 default (other créances)', () => {
    expect(resolveProvisionCategory('491000').code).toBe('DEPREC_COMPTES_CLIENTS');
    expect(resolveProvisionCategory('495000').code).toBe('DEPREC_AUTRES');
    expect(resolveProvisionCategory('590000').code).toBe('DEPREC_AUTRES');
  });

  it('routes the 293 split (en cours) by incorporelle vs corporelle sub-code', () => {
    expect(resolveProvisionCategory('293100').code).toBe('DEPREC_CORPORELLES'); // 2931
    expect(resolveProvisionCategory('293200').code).toBe('DEPREC_INCORPORELLES'); // 2932
  });

  it('throws for an account outside any known provision/dépréciation prefix', () => {
    expect(() => resolveProvisionCategory('411000')).toThrow(/no 2056 provision-nature mapping/);
  });

  it('throws for 1423/1424-adjacent codes with no PCG counterpart (e.g. 1425)', () => {
    expect(() => resolveProvisionCategory('142500')).toThrow(/no 2056 provision-nature mapping/);
  });
});

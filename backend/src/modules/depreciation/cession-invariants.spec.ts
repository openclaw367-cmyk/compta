import { BadRequestException, NotImplementedException } from '@nestjs/common';
import { resolveCessionNature, assertValidCompteReglement, CESSION_ACCOUNTS } from './cession-invariants';

describe('resolveCessionNature', () => {
  it('routes 20x accounts (frais établissement, concessions/brevets, fonds commercial) to INCORPORELLE', () => {
    expect(resolveCessionNature('201000')).toBe('INCORPORELLE');
    expect(resolveCessionNature('205000')).toBe('INCORPORELLE');
    expect(resolveCessionNature('207000')).toBe('INCORPORELLE');
  });

  it('routes 21x/218x accounts (terrains, constructions, matériel, mobilier) to CORPORELLE', () => {
    expect(resolveCessionNature('211000')).toBe('CORPORELLE');
    expect(resolveCessionNature('213000')).toBe('CORPORELLE');
    expect(resolveCessionNature('215400')).toBe('CORPORELLE');
    expect(resolveCessionNature('218300')).toBe('CORPORELLE');
  });

  it('rejects financières (26x/27x) as not implemented', () => {
    expect(() => resolveCessionNature('261000')).toThrow(NotImplementedException);
    expect(() => resolveCessionNature('274000')).toThrow(NotImplementedException);
  });

  it('rejects amortissements/dépréciations contra-accounts (28x/29x)', () => {
    expect(() => resolveCessionNature('281300')).toThrow(BadRequestException);
    expect(() => resolveCessionNature('291000')).toThrow(BadRequestException);
  });
});

describe('CESSION_ACCOUNTS', () => {
  it('maps each nature to its own 675x/775x pair, matching the compte-resultat-2052-2053.ts routing (6752/7752 -> G1/F1)', () => {
    expect(CESSION_ACCOUNTS.INCORPORELLE).toEqual({ vnc: '675100', produit: '775100' });
    expect(CESSION_ACCOUNTS.CORPORELLE).toEqual({ vnc: '675200', produit: '775200' });
  });
});

describe('assertValidCompteReglement', () => {
  it('accepts a 462-prefixed créance account', () => {
    expect(() => assertValidCompteReglement({ number: '462000', pcgClass: 4 })).not.toThrow();
  });

  it('accepts any class-5 (financier) account', () => {
    expect(() => assertValidCompteReglement({ number: '512000', pcgClass: 5 })).not.toThrow();
    expect(() => assertValidCompteReglement({ number: '530000', pcgClass: 5 })).not.toThrow();
  });

  it('rejects anything else', () => {
    expect(() => assertValidCompteReglement({ number: '411000', pcgClass: 4 })).toThrow(
      BadRequestException,
    );
  });
});

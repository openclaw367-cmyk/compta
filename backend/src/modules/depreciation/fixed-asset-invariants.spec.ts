import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Money } from '../../common/decimal';
import {
  assertValidAccountTriplet,
  assertWithinDepreciableBase,
  computeFixedAssetSummary,
} from './fixed-asset-invariants';

describe('computeFixedAssetSummary', () => {
  it('computes VNC = valeurBrute - amortissementsCumules from posted dotations only', () => {
    const asset = { acquisitionValue: new Prisma.Decimal('12000.00') };
    const posted = [
      { amount: new Prisma.Decimal('4000.00') },
      { amount: new Prisma.Decimal('4000.00') },
    ];

    const summary = computeFixedAssetSummary(asset, posted);

    expect(summary.valeurBrute.toApiString()).toBe('12000.00');
    expect(summary.amortissementsCumules.toApiString()).toBe('8000.00');
    expect(summary.vnc.toApiString()).toBe('4000.00');
    expect(summary.vnc.toApiString()).toBe(
      summary.valeurBrute.minus(summary.amortissementsCumules).toApiString(),
    );
  });

  it('is the full acquisition value when nothing has been posted yet', () => {
    const asset = { acquisitionValue: new Prisma.Decimal('5000.00') };
    const summary = computeFixedAssetSummary(asset, []);
    expect(summary.amortissementsCumules.toApiString()).toBe('0.00');
    expect(summary.vnc.toApiString()).toBe('5000.00');
  });
});

describe('assertWithinDepreciableBase', () => {
  const asset = {
    acquisitionValue: new Prisma.Decimal('1000.00'),
    residualValue: new Prisma.Decimal('100.00'),
  };

  it('allows posting up to exactly the depreciable base', () => {
    expect(() =>
      assertWithinDepreciableBase(asset, Money.fromString('800.00'), Money.fromString('100.00')),
    ).not.toThrow();
  });

  it('refuses to post past the depreciable base', () => {
    expect(() =>
      assertWithinDepreciableBase(asset, Money.fromString('800.00'), Money.fromString('100.01')),
    ).toThrow(ConflictException);
  });
});

describe('assertValidAccountTriplet', () => {
  const validTriplet = {
    asset: { number: '218300', pcgClass: 2 },
    depreciation: { number: '281830', pcgClass: 2 },
    expense: { number: '681100', pcgClass: 6 },
  };

  it('accepts a well-formed triplet', () => {
    expect(() => assertValidAccountTriplet(validTriplet)).not.toThrow();
  });

  it('rejects an asset account outside PCG class 2', () => {
    expect(() =>
      assertValidAccountTriplet({ ...validTriplet, asset: { number: '607000', pcgClass: 6 } }),
    ).toThrow(BadRequestException);
  });

  it('rejects an amortissements (28x) account used as the asset account', () => {
    expect(() =>
      assertValidAccountTriplet({ ...validTriplet, asset: { number: '281830', pcgClass: 2 } }),
    ).toThrow(BadRequestException);
  });

  it('rejects a depreciation account not prefixed 28', () => {
    expect(() =>
      assertValidAccountTriplet({ ...validTriplet, depreciation: { number: '218300', pcgClass: 2 } }),
    ).toThrow(BadRequestException);
  });

  it('rejects an expense account not prefixed 681', () => {
    expect(() =>
      assertValidAccountTriplet({ ...validTriplet, expense: { number: '607000', pcgClass: 6 } }),
    ).toThrow(BadRequestException);
  });
});

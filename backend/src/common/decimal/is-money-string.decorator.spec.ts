import { validate } from 'class-validator';
import { IsMoneyString } from './is-money-string.decorator';

class MoneyDto {
  @IsMoneyString()
  amount!: string;
}

async function errorsFor(amount: unknown): Promise<number> {
  const dto = new MoneyDto();
  dto.amount = amount as string;
  const errors = await validate(dto);
  return errors.length;
}

describe('IsMoneyString', () => {
  it('accepts a plain integer string', async () => {
    expect(await errorsFor('1200')).toBe(0);
  });

  it('accepts a 2-decimal string', async () => {
    expect(await errorsFor('1234.56')).toBe(0);
  });

  it('rejects a JS number, even one that looks like valid money', async () => {
    expect(await errorsFor(1234.56)).toBeGreaterThan(0);
  });

  it('rejects more than 2 decimal places', async () => {
    expect(await errorsFor('1234.567')).toBeGreaterThan(0);
  });

  it('rejects a negative amount (debit/credit lines are always positive)', async () => {
    expect(await errorsFor('-1234.56')).toBeGreaterThan(0);
  });

  it('rejects a comma decimal separator', async () => {
    expect(await errorsFor('1234,56')).toBeGreaterThan(0);
  });

  it('rejects non-numeric strings', async () => {
    expect(await errorsFor('abc')).toBeGreaterThan(0);
  });
});

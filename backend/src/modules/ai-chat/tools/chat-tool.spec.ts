import { BadRequestException, NotFoundException } from '@nestjs/common';
import { extractErrorMessage } from './chat-tool';

describe('extractErrorMessage', () => {
  it('returns the plain message for a single-string exception (e.g. NotFoundException)', () => {
    const err = new NotFoundException('Fiscal year xyz not found');
    expect(extractErrorMessage(err)).toBe('Fiscal year xyz not found');
  });

  it('joins the real constraint messages for an array-constructed BadRequestException, not the generic status text', () => {
    // This is exactly the shape class-validator/ValidationPipe throws:
    // new BadRequestException(['debit must be a valid money string', 'lignes must contain at least 2 elements']).
    const err = new BadRequestException([
      'debit must be a valid money string',
      'lignes must contain at least 2 elements',
    ]);
    // The bug this guards: err.message here is just "Bad Request Exception".
    expect(err.message).toBe('Bad Request Exception');
    const extracted = extractErrorMessage(err);
    expect(extracted).toContain('debit must be a valid money string');
    expect(extracted).toContain('lignes must contain at least 2 elements');
  });

  it('falls back to a plain Error message when there is no getResponse()', () => {
    expect(extractErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('falls back to String() for a non-Error throw', () => {
    expect(extractErrorMessage('just a string')).toBe('just a string');
  });
});

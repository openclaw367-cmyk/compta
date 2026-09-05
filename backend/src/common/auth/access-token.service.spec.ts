import { InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { AccessTokenService } from './access-token.service';
import { ConfigService } from '@nestjs/config';

function makeService(secret: string | undefined) {
  const config = { get: jest.fn().mockReturnValue(secret) };
  return new AccessTokenService(config as unknown as ConfigService);
}

describe('AccessTokenService', () => {
  it('signs and verifies a token round-trip', () => {
    const service = makeService('a-test-secret');
    const token = service.sign({ sub: 'user-1', email: 'jane@example.com' });
    const payload = service.verify(token);
    expect(payload).toMatchObject({ sub: 'user-1', email: 'jane@example.com' });
  });

  it('rejects a token signed with a different secret', () => {
    const signer = makeService('secret-a');
    const verifier = makeService('secret-b');
    const token = signer.sign({ sub: 'user-1', email: 'jane@example.com' });
    expect(() => verifier.verify(token)).toThrow(UnauthorizedException);
  });

  it('rejects garbage input', () => {
    const service = makeService('a-test-secret');
    expect(() => service.verify('not-a-real-token')).toThrow(UnauthorizedException);
  });

  it('throws a clear, named error when JWT_ACCESS_SECRET is not configured', () => {
    const service = makeService(undefined);
    expect(() => service.sign({ sub: 'user-1', email: 'jane@example.com' })).toThrow(
      InternalServerErrorException,
    );
  });
});

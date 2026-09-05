import { UnauthorizedException } from '@nestjs/common';
import { AuthMiddleware } from './auth.middleware';
import { AccessTokenService } from './access-token.service';
import { RequestWithUser } from './request-with-user';

function makeReq(header: string | undefined): RequestWithUser {
  return {
    header: jest.fn().mockReturnValue(header),
  } as unknown as RequestWithUser;
}

describe('AuthMiddleware', () => {
  it('sets req.user from a valid Bearer token', () => {
    const accessTokens = {
      verify: jest.fn().mockReturnValue({ sub: 'user-1', email: 'jane@example.com' }),
    };
    const middleware = new AuthMiddleware(accessTokens as unknown as AccessTokenService);
    const req = makeReq('Bearer a-valid-token');
    const next = jest.fn();

    middleware.use(req, {} as never, next);

    expect(accessTokens.verify).toHaveBeenCalledWith('a-valid-token');
    expect(req.user).toEqual({ id: 'user-1', email: 'jane@example.com' });
    expect(next).toHaveBeenCalled();
  });

  it('rejects a missing Authorization header', () => {
    const accessTokens = { verify: jest.fn() };
    const middleware = new AuthMiddleware(accessTokens as unknown as AccessTokenService);
    expect(() => middleware.use(makeReq(undefined), {} as never, jest.fn())).toThrow(
      UnauthorizedException,
    );
    expect(accessTokens.verify).not.toHaveBeenCalled();
  });

  it('rejects a header that is not "Bearer <token>"', () => {
    const accessTokens = { verify: jest.fn() };
    const middleware = new AuthMiddleware(accessTokens as unknown as AccessTokenService);
    expect(() => middleware.use(makeReq('Basic something'), {} as never, jest.fn())).toThrow(
      UnauthorizedException,
    );
  });

  it('propagates an invalid/expired token as a 401 (AccessTokenService.verify already throws)', () => {
    const accessTokens = {
      verify: jest.fn().mockImplementation(() => {
        throw new UnauthorizedException('Invalid or expired access token.');
      }),
    };
    const middleware = new AuthMiddleware(accessTokens as unknown as AccessTokenService);
    expect(() => middleware.use(makeReq('Bearer bad-token'), {} as never, jest.fn())).toThrow(
      UnauthorizedException,
    );
  });
});

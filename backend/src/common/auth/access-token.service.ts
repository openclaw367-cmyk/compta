import * as jwt from 'jsonwebtoken';
import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

/**
 * Signs/verifies the short-lived (15 min) JWT access token — see
 * CLAUDE.md "Multi-user / roles & permissions". Deliberately the ONLY
 * token type that's a JWT: the refresh token is a separate opaque
 * random value hashed at rest (RefreshToken model), since a JWT can't be
 * individually revoked without a blocklist, and revocation/rotation is
 * exactly what the refresh token needs. This service has no per-request
 * state, so it's registered once in CommonAuthModule (@Global(), same
 * precedent as PrismaModule/CryptoModule) and shared by AuthMiddleware
 * (verify) and AuthService (sign).
 *
 * JWT_ACCESS_SECRET is read LAZILY via ConfigService, same
 * "fail clearly on first real use, never at boot" discipline as
 * CredentialEncryptionService's own CLOUD_CREDENTIAL_ENCRYPTION_KEY —
 * except here there's no "fresh install talks to nobody" escape hatch:
 * auth is core once this ships, so a missing secret breaks EVERY
 * request, not just one optional feature. Still fails with a clear,
 * named error rather than a cryptic downstream 500.
 *
 * Uses the `jsonwebtoken` package directly, NOT `@nestjs/jwt` — found
 * live, not by inspection: `@nestjs/jwt@12` ships `"type": "module"`
 * (ESM-only), which breaks under this backend's CommonJS Jest transform
 * exactly like the `@stafyniaksacha/facturx`/`libxml2-wasm` case already
 * documented in CLAUDE.md ("Invoicing — Factur-X rendering"). Unlike
 * that case, there's a mature, actively-maintained CJS alternative
 * (`jsonwebtoken` itself, the library `@nestjs/jwt` wraps anyway), so
 * the fix here is simpler: depend on it directly rather than reaching
 * for an ESM-interop workaround. This is the ONLY file in the codebase
 * that imports `jsonwebtoken` — every other file goes through this
 * service.
 */
@Injectable()
export class AccessTokenService {
  constructor(private readonly config: ConfigService) {}

  sign(payload: AccessTokenPayload): string {
    return jwt.sign(payload, this.getSecret(), { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  }

  verify(token: string): AccessTokenPayload {
    try {
      return jwt.verify(token, this.getSecret()) as AccessTokenPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token.');
    }
  }

  private getSecret(): string {
    const secret = this.config.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      throw new InternalServerErrorException(
        'JWT_ACCESS_SECRET is not set — required for authentication to work at all. ' +
          "Generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"` " +
          'and add it to backend/.env.',
      );
    }
    return secret;
  }
}

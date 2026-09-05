import { Global, Module } from '@nestjs/common';
import { AccessTokenService } from './access-token.service';
import { AuthMiddleware } from './auth.middleware';

/**
 * Global, same precedent as PrismaModule/CryptoModule —
 * AccessTokenService/AuthMiddleware have no per-request state of their
 * own beyond what's threaded through method params, and both are needed
 * across the entire module graph (every domain module's controller sits
 * behind AuthMiddleware).
 */
@Global()
@Module({
  providers: [AccessTokenService, AuthMiddleware],
  exports: [AccessTokenService, AuthMiddleware],
})
export class CommonAuthModule {}

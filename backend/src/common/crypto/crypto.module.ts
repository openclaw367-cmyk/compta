import { Global, Module } from '@nestjs/common';
import { CredentialEncryptionService } from './credential-encryption.service';

/**
 * Global, same as PrismaModule — CredentialEncryptionService has no
 * per-request state and will be needed by both CloudCredentialsService
 * (encrypt on save, mask for display) and the cloud model adapters
 * (decrypt to actually call a provider) once those land.
 */
@Global()
@Module({
  providers: [CredentialEncryptionService],
  exports: [CredentialEncryptionService],
})
export class CryptoModule {}

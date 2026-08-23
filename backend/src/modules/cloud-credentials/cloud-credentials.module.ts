import { Module } from '@nestjs/common';
import { CloudCredentialsController } from './cloud-credentials.controller';
import { CloudCredentialsService } from './cloud-credentials.service';

/**
 * CredentialEncryptionService comes from the global CryptoModule (see
 * app.module.ts / crypto.module.ts) — not re-declared here.
 */
@Module({
  controllers: [CloudCredentialsController],
  providers: [CloudCredentialsService],
  exports: [CloudCredentialsService],
})
export class CloudCredentialsModule {}

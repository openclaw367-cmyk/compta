import { Module } from '@nestjs/common';
import { ConsoleMailerAdapter } from './console-mailer.adapter';
import { MAILER_PORT } from './mailer.port';

/**
 * The one place that would switch on a MAILER_PROVIDER env var once a
 * second (real) adapter exists — see mailer.port.ts. Today there's only
 * one implementation, so this is a direct binding, not a factory.
 */
@Module({
  providers: [{ provide: MAILER_PORT, useClass: ConsoleMailerAdapter }],
  exports: [MAILER_PORT],
})
export class MailerModule {}

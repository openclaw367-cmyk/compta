import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleMailerAdapter } from './console-mailer.adapter';
import { SmtpMailerAdapter } from './smtp-mailer.adapter';
import { MAILER_PORT } from './mailer.port';

/**
 * Switches on `MAILER_PROVIDER` ('console', the default; 'smtp', real —
 * see CLAUDE.md "Mailer — SMTP adapter") — the one place mailer.port.ts's
 * own doc comment anticipated: "the one place that would switch on a
 * MAILER_PROVIDER env var once a second (real) adapter exists." Both
 * adapters are cheap to construct (no I/O at construction time — SMTP
 * config is read lazily inside `SmtpMailerAdapter.send()`, not here), so
 * a `useFactory` rather than `useClass` costs nothing and is what makes
 * the branch possible.
 */
@Module({
  providers: [
    {
      provide: MAILER_PORT,
      useFactory: (config: ConfigService) => {
        const provider = config.get<string>('MAILER_PROVIDER') ?? 'console';
        if (provider === 'smtp') {
          return new SmtpMailerAdapter(config);
        }
        return new ConsoleMailerAdapter();
      },
      inject: [ConfigService],
    },
  ],
  exports: [MAILER_PORT],
})
export class MailerModule {}

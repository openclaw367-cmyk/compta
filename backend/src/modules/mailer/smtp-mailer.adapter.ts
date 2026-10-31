import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailerPort } from './mailer.port';

/**
 * ⚠️ NOT VERIFIED AGAINST A REAL SMTP ACCOUNT — no email has ever actually
 * been delivered through this adapter. Unlike `BridgeAggregatorAdapter`
 * (see CLAUDE.md "Bank reconciliation — Layer 1b"), the message
 * construction and the `nodemailer` library's own documented API shape
 * ARE unit-tested here (`smtp-mailer.adapter.spec.ts`) against a mocked
 * transport — so this is less speculative than a pure paper design — but
 * nothing below has been exercised against a real SMTP server. Before
 * relying on this in production: set `MAILER_PROVIDER=smtp` plus the
 * `SMTP_*` env vars below against a real account (Gmail app password, a
 * self-hosted Postfix/Exim relay, SendGrid's/Mailgun's own SMTP relay,
 * ...) and confirm with a real test send (password-reset and
 * company-invite both go through the exact same two methods) before
 * trusting this path for a real user. See CLAUDE.md "Mailer — SMTP
 * adapter" for the full record.
 *
 * `nodemailer` was chosen over any vendor-specific HTTP API because it's
 * provider-agnostic — this app's own BYO-credentials, self-hosted-first
 * deployment model (see CLAUDE.md "Multi-tenant data model" and
 * `CredentialEncryptionService`'s own threat model) means the operator
 * brings whatever SMTP relay they already have, not a specific vendor
 * SDK this codebase would have to pick for them.
 *
 * SMTP config is read LAZILY, inside `send()`, never at construction —
 * mirrors `CredentialEncryptionService.getKey()`'s own lazy-read
 * discipline exactly: a `MAILER_PROVIDER=console` install (the default)
 * must never even touch these env vars, let alone fail to boot over a
 * missing one. A fresh transport is built on every send (no cached
 * instance field) for the same reason `CredentialEncryptionService`
 * re-reads its key on every call rather than caching it — config can
 * change between calls (e.g. in a test), and a cheap-to-construct
 * transport object (it doesn't open a socket until `sendMail()` runs)
 * costs nothing to rebuild. `MAILER_PROVIDER=smtp` with a missing
 * required env var throws a clear, named error — it never silently
 * falls back to console-logging the email instead, which would be a
 * surprising, hard-to-notice behavior change for whoever set that env
 * var expecting a real email to go out.
 */
@Injectable()
export class SmtpMailerAdapter implements MailerPort {
  private readonly logger = new Logger('Mailer');

  constructor(private readonly config: ConfigService) {}

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    await this.send(
      to,
      'Réinitialisez votre mot de passe',
      `Cliquez sur ce lien pour réinitialiser votre mot de passe (valable 1 heure) :\n${resetUrl}`,
    );
  }

  async sendCompanyInviteEmail(
    to: string,
    companyName: string,
    inviteUrl: string,
    invitedByEmail: string,
  ): Promise<void> {
    await this.send(
      to,
      `${invitedByEmail} vous invite à rejoindre « ${companyName} »`,
      `${invitedByEmail} vous invite à rejoindre « ${companyName} » sur Citaledge. ` +
        `Cliquez sur ce lien pour accepter (valable 7 jours) :\n${inviteUrl}`,
    );
  }

  private async send(to: string, subject: string, text: string): Promise<void> {
    const transporter = this.buildTransporter();
    const from = this.requireEnv('SMTP_FROM');
    try {
      await transporter.sendMail({ from, to, subject, text });
    } catch (error) {
      this.logger.error(`Failed to send email to ${to} via SMTP: ${(error as Error).message}`);
      throw error;
    }
  }

  private buildTransporter(): nodemailer.Transporter {
    const host = this.requireEnv('SMTP_HOST');
    const port = this.resolvePort();
    const user = this.requireEnv('SMTP_USER');
    const pass = this.requireEnv('SMTP_PASS');
    return nodemailer.createTransport({
      host,
      port,
      secure: this.resolveSecure(port),
      auth: { user, pass },
    });
  }

  private resolvePort(): number {
    const configured = this.config.get<string>('SMTP_PORT');
    if (configured === undefined || configured === '') {
      return 587;
    }
    const parsed = Number(configured);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new InternalServerErrorException(
        `SMTP_PORT must be a positive integer; got "${configured}". Fix backend/.env.`,
      );
    }
    return parsed;
  }

  /**
   * Nodemailer's own documented convention: `secure: true` means SMTPS
   * (implicit TLS, typically port 465); `secure: false` means plain or
   * STARTTLS (typically port 587). `SMTP_SECURE` lets an operator
   * override this explicitly; absent, it's inferred from the port —
   * never guessed beyond that documented convention.
   */
  private resolveSecure(port: number): boolean {
    const configured = this.config.get<string>('SMTP_SECURE');
    if (configured !== undefined && configured !== '') {
      return configured === 'true' || configured === '1';
    }
    return port === 465;
  }

  private requireEnv(name: string): string {
    const value = this.config.get<string>(name);
    if (!value) {
      throw new InternalServerErrorException(
        `${name} is not set — required when MAILER_PROVIDER=smtp. Set it in backend/.env, ` +
          'or switch MAILER_PROVIDER back to "console" for local dev with no real SMTP account.',
      );
    }
    return value;
  }
}

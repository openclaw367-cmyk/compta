import { Injectable, Logger } from '@nestjs/common';
import { MailerPort } from './mailer.port';

/**
 * The default (and, this pass, only) MailerPort implementation — logs a
 * clearly-formatted email in place of sending one. See mailer.port.ts's
 * own doc comment for why this is a deliberate, fully-functional
 * dev-local choice, not a stopgap: reading the printed URL and pasting
 * it into a browser completes the real flow exactly as a clicked email
 * link would.
 */
@Injectable()
export class ConsoleMailerAdapter implements MailerPort {
  private readonly logger = new Logger('Mailer');

  sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    this.logger.log(
      `\n----- Password reset email -----\n` +
        `To: ${to}\n` +
        `Subject: Réinitialisez votre mot de passe\n\n` +
        `Cliquez sur ce lien pour réinitialiser votre mot de passe (valable 1 heure) :\n` +
        `${resetUrl}\n` +
        `---------------------------------`,
    );
    return Promise.resolve();
  }

  sendCompanyInviteEmail(
    to: string,
    companyName: string,
    inviteUrl: string,
    invitedByEmail: string,
  ): Promise<void> {
    this.logger.log(
      `\n----- Company invite email -----\n` +
        `To: ${to}\n` +
        `Subject: ${invitedByEmail} vous invite à rejoindre « ${companyName} »\n\n` +
        `${invitedByEmail} vous invite à rejoindre « ${companyName} » sur Citaledge. ` +
        `Cliquez sur ce lien pour accepter (valable 7 jours) :\n` +
        `${inviteUrl}\n` +
        `---------------------------------`,
    );
    return Promise.resolve();
  }
}

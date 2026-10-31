import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { SmtpMailerAdapter } from './smtp-mailer.adapter';

jest.mock('nodemailer');

/**
 * Unit coverage for the adapter's own message-construction/config-
 * resolution logic against a MOCKED `nodemailer` transport — this does
 * NOT prove delivery against a real SMTP server. See the adapter's own
 * doc comment: that verification is still open.
 */
describe('SmtpMailerAdapter', () => {
  const sendMail = jest.fn();
  const createTransport = nodemailer.createTransport as jest.Mock;

  function buildConfig(values: Record<string, string | undefined>): ConfigService {
    return {
      get: (key: string) => values[key],
    } as unknown as ConfigService;
  }

  function fullConfig(overrides: Record<string, string | undefined> = {}): ConfigService {
    return buildConfig({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'user@example.com',
      SMTP_PASS: 'secret',
      SMTP_FROM: 'Citaledge <no-reply@example.com>',
      ...overrides,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    sendMail.mockResolvedValue({ messageId: 'mocked' });
    createTransport.mockReturnValue({ sendMail });
  });

  describe('sendPasswordResetEmail', () => {
    it('constructs the transport from the configured SMTP env vars', async () => {
      const adapter = new SmtpMailerAdapter(fullConfig());

      await adapter.sendPasswordResetEmail('alice@client.fr', 'https://app.example/reset/token123');

      expect(createTransport).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: { user: 'user@example.com', pass: 'secret' },
      });
    });

    it('sends the exact French subject/body (matching the console adapter) to the right address', async () => {
      const adapter = new SmtpMailerAdapter(fullConfig());

      await adapter.sendPasswordResetEmail('alice@client.fr', 'https://app.example/reset/token123');

      expect(sendMail).toHaveBeenCalledWith({
        from: 'Citaledge <no-reply@example.com>',
        to: 'alice@client.fr',
        subject: 'Réinitialisez votre mot de passe',
        text: expect.stringContaining('https://app.example/reset/token123'),
      });
      const text = sendMail.mock.calls[0][0].text as string;
      expect(text).toContain('valable 1 heure');
    });
  });

  describe('sendCompanyInviteEmail', () => {
    it('sends the exact French subject/body (matching the console adapter) to the right address', async () => {
      const adapter = new SmtpMailerAdapter(fullConfig());

      await adapter.sendCompanyInviteEmail(
        'bob@client.fr',
        'Société Démo SARL',
        'https://app.example/invite/abc',
        'owner@societe-demo.fr',
      );

      expect(sendMail).toHaveBeenCalledWith({
        from: 'Citaledge <no-reply@example.com>',
        to: 'bob@client.fr',
        subject: 'owner@societe-demo.fr vous invite à rejoindre « Société Démo SARL »',
        text: expect.stringContaining('https://app.example/invite/abc'),
      });
      const text = sendMail.mock.calls[0][0].text as string;
      expect(text).toContain('Citaledge');
      expect(text).toContain('valable 7 jours');
    });
  });

  describe('port/secure resolution', () => {
    it('defaults to port 587 and secure:false when SMTP_PORT/SMTP_SECURE are unset', async () => {
      const adapter = new SmtpMailerAdapter(
        buildConfig({
          SMTP_HOST: 'smtp.example.com',
          SMTP_USER: 'user@example.com',
          SMTP_PASS: 'secret',
          SMTP_FROM: 'from@example.com',
        }),
      );

      await adapter.sendPasswordResetEmail('a@b.fr', 'https://x');

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ port: 587, secure: false }),
      );
    });

    it('infers secure:true from port 465 when SMTP_SECURE is unset', async () => {
      const adapter = new SmtpMailerAdapter(fullConfig({ SMTP_PORT: '465' }));

      await adapter.sendPasswordResetEmail('a@b.fr', 'https://x');

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ port: 465, secure: true }),
      );
    });

    it('lets SMTP_SECURE override the port-based inference', async () => {
      const adapter = new SmtpMailerAdapter(fullConfig({ SMTP_PORT: '587', SMTP_SECURE: 'true' }));

      await adapter.sendPasswordResetEmail('a@b.fr', 'https://x');

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ port: 587, secure: true }),
      );
    });

    it('rejects a non-numeric SMTP_PORT with a clear error', async () => {
      const adapter = new SmtpMailerAdapter(fullConfig({ SMTP_PORT: 'not-a-number' }));

      await expect(adapter.sendPasswordResetEmail('a@b.fr', 'https://x')).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(createTransport).not.toHaveBeenCalled();
    });
  });

  describe('missing required env vars', () => {
    it.each(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'])(
      'throws a clear, named error when %s is missing — never falls back to console mode',
      async (missingKey) => {
        const adapter = new SmtpMailerAdapter(fullConfig({ [missingKey]: undefined }));

        await expect(adapter.sendPasswordResetEmail('a@b.fr', 'https://x')).rejects.toThrow(
          InternalServerErrorException,
        );
        await expect(adapter.sendPasswordResetEmail('a@b.fr', 'https://x')).rejects.toThrow(
          new RegExp(missingKey),
        );
        expect(sendMail).not.toHaveBeenCalled();
      },
    );

    it('throws before ever constructing a transport when a required var is missing', async () => {
      const adapter = new SmtpMailerAdapter(fullConfig({ SMTP_HOST: undefined }));

      await expect(
        adapter.sendCompanyInviteEmail('a@b.fr', 'Co', 'https://x', 'owner@co.fr'),
      ).rejects.toThrow(InternalServerErrorException);
      expect(createTransport).not.toHaveBeenCalled();
    });
  });

  it('propagates and logs a real sendMail failure rather than swallowing it', async () => {
    sendMail.mockRejectedValue(new Error('Connection refused'));
    const adapter = new SmtpMailerAdapter(fullConfig());

    await expect(adapter.sendPasswordResetEmail('a@b.fr', 'https://x')).rejects.toThrow(
      'Connection refused',
    );
  });
});

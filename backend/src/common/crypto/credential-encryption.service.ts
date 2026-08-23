import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const FORMAT_VERSION = 'v1';

/**
 * Encrypts/decrypts a company's own (BYO) cloud-provider API key before it
 * touches the database — see CloudModelCredential's own doc comment in
 * schema.prisma and CLAUDE.md "AI chatbot cloud tier" for the design this
 * implements.
 *
 * THE REAL THREAT MODEL, stated honestly rather than implied stronger than
 * it is: the encryption key (`CLOUD_CREDENTIAL_ENCRYPTION_KEY`) lives in
 * `backend/.env`, OUTSIDE the database entirely. This defends against a
 * leaked/stolen database backup, a `pg_dump`, or casual inspection of the
 * database — none of those alone can decrypt a stored key. It does NOT
 * defend against an attacker with full filesystem access to this machine
 * (who can read both `.env` and the database), or a compromise of the
 * backend process itself (which necessarily decrypts the key in memory to
 * call the provider). For this app's local-first, single-tenant-in-practice
 * deployment today, that's the accepted guarantee — "your own machine, your
 * own key" — not a stronger one. If this app ever runs multi-tenant on
 * shared/cloud infrastructure (see CLAUDE.md "Multi-tenant data model"),
 * this needs revisiting (a real KMS, per-tenant key derivation) before
 * cloud credentials ship in that configuration.
 *
 * The key is read LAZILY, inside encrypt()/decrypt(), never at
 * construction or app-boot time — a fresh install with no cloud intent
 * configured must still start cleanly (CLAUDE.md's own "fresh install
 * talks to nobody" default). Only the first attempt to actually store or
 * use a cloud credential can fail on a missing/malformed key, and it fails
 * with a clear, named error rather than silently falling back to no
 * encryption at all.
 */
@Injectable()
export class CredentialEncryptionService {
  constructor(private readonly config: ConfigService) {}

  encrypt(plaintext: string): string {
    const key = this.getKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      FORMAT_VERSION,
      iv.toString('hex'),
      authTag.toString('hex'),
      ciphertext.toString('hex'),
    ].join(':');
  }

  decrypt(stored: string): string {
    const key = this.getKey();
    const parts = stored.split(':');
    if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
      throw new InternalServerErrorException(
        'Stored credential is not in the expected v1:<iv>:<authTag>:<ciphertext> format.',
      );
    }
    const [, ivHex, authTagHex, ciphertextHex] = parts;
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, 'hex')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  /**
   * A display-safe hint (e.g. "sk-...ab12") — never the real key. Kept
   * separate from encrypt()/decrypt() specifically so listing credentials
   * for the settings UI never needs to decrypt the real key; decryption
   * is reserved for the one place that actually calls the provider.
   */
  mask(plaintext: string): string {
    if (plaintext.length <= 8) {
      return '••••';
    }
    return `${plaintext.slice(0, 3)}...${plaintext.slice(-4)}`;
  }

  private getKey(): Buffer {
    const configured = this.config.get<string>('CLOUD_CREDENTIAL_ENCRYPTION_KEY');
    if (!configured) {
      throw new InternalServerErrorException(
        'CLOUD_CREDENTIAL_ENCRYPTION_KEY is not set — required to store or read a cloud API key. ' +
          "Generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"` " +
          'and add it to backend/.env. This is unrelated to using the assistant locally — it is only ' +
          'needed the first time a cloud provider credential is saved.',
      );
    }
    const key = Buffer.from(configured, 'hex');
    if (key.length !== KEY_BYTES) {
      throw new InternalServerErrorException(
        `CLOUD_CREDENTIAL_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex ` +
          `characters); got ${key.length}. Regenerate it — never pad or truncate an existing value.`,
      );
    }
    return key;
  }
}

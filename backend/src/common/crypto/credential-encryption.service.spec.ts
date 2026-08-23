import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CredentialEncryptionService } from './credential-encryption.service';

const VALID_KEY_HEX = '0'.repeat(63) + '1'; // 32 bytes, deterministic for tests
const OTHER_KEY_HEX = '1'.repeat(63) + '0'; // a different 32-byte key

function buildService(
  env: Record<string, string> = { CLOUD_CREDENTIAL_ENCRYPTION_KEY: VALID_KEY_HEX },
) {
  const config = { get: jest.fn((key: string) => env[key]) } as unknown as ConfigService;
  return new CredentialEncryptionService(config);
}

describe('CredentialEncryptionService', () => {
  it('round-trips a plaintext API key through encrypt() then decrypt()', () => {
    const service = buildService();
    const ciphertext = service.encrypt('sk-ant-real-secret-value-123456');
    expect(service.decrypt(ciphertext)).toBe('sk-ant-real-secret-value-123456');
  });

  it('never stores the plaintext inside the ciphertext string', () => {
    const service = buildService();
    const plaintext = 'sk-ant-real-secret-value-123456';
    const ciphertext = service.encrypt(plaintext);
    expect(ciphertext).not.toContain(plaintext);
  });

  it('produces a different ciphertext each time (random IV), both still decrypting correctly', () => {
    const service = buildService();
    const a = service.encrypt('same-plaintext');
    const b = service.encrypt('same-plaintext');
    expect(a).not.toBe(b);
    expect(service.decrypt(a)).toBe('same-plaintext');
    expect(service.decrypt(b)).toBe('same-plaintext');
  });

  it('refuses to decrypt with a different key than the one used to encrypt', () => {
    const encryptor = buildService({ CLOUD_CREDENTIAL_ENCRYPTION_KEY: VALID_KEY_HEX });
    const ciphertext = encryptor.encrypt('secret');
    const decryptorWithWrongKey = buildService({ CLOUD_CREDENTIAL_ENCRYPTION_KEY: OTHER_KEY_HEX });
    expect(() => decryptorWithWrongKey.decrypt(ciphertext)).toThrow();
  });

  it('refuses to decrypt a tampered ciphertext (GCM auth tag check)', () => {
    const service = buildService();
    const ciphertext = service.encrypt('secret');
    const [version, iv, authTag, body] = ciphertext.split(':');
    const tampered = [version, iv, authTag, body.slice(0, -2) + '00'].join(':');
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('throws a clear, named error when CLOUD_CREDENTIAL_ENCRYPTION_KEY is not set — never falls back silently', () => {
    const service = buildService({});
    expect(() => service.encrypt('secret')).toThrow(InternalServerErrorException);
    expect(() => service.encrypt('secret')).toThrow(/CLOUD_CREDENTIAL_ENCRYPTION_KEY is not set/);
  });

  it('throws a clear error when the configured key is the wrong length', () => {
    const service = buildService({ CLOUD_CREDENTIAL_ENCRYPTION_KEY: 'tooshort' });
    expect(() => service.encrypt('secret')).toThrow(/must decode to exactly 32 bytes/);
  });

  it('rejects a stored value in an unrecognized format rather than guessing', () => {
    const service = buildService();
    expect(() => service.decrypt('not-the-expected-format')).toThrow(
      /not in the expected v1:<iv>:<authTag>:<ciphertext> format/,
    );
  });

  it('mask() shows only a short prefix/suffix hint, never the full key', () => {
    const service = buildService();
    expect(service.mask('sk-ant-api03-abcdefghijklmnopqrstuvwxyzab12')).toBe('sk-...ab12');
  });

  it('mask() fully masks a very short value rather than revealing all of it', () => {
    const service = buildService();
    expect(service.mask('shortkey')).toBe('••••');
  });
});

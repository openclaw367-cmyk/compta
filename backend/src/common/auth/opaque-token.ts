import { createHash, randomBytes } from 'crypto';

/**
 * The shared "never store the raw token" primitive behind RefreshToken,
 * PasswordResetToken, and CompanyInvite — see CLAUDE.md "Multi-user /
 * roles & permissions". `raw` is what's emailed/cookied to the caller;
 * only `hash` (SHA-256 hex) is ever persisted. One-way by construction —
 * there is no decrypt(), unlike CredentialEncryptionService, since these
 * tokens only ever need to be COMPARED, never recovered.
 */
export function generateOpaqueToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashOpaqueToken(raw) };
}

export function hashOpaqueToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

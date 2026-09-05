/**
 * The abstraction every transactional email in this app goes through —
 * see CLAUDE.md "Multi-user / roles & permissions". Mirrors
 * `ChatModelPort`/`BankAggregatorPort`'s own role exactly: ONE
 * interface, `ConsoleMailerAdapter` the only implementation this pass
 * ships. Unlike the Bridge aggregator adapter (a paper design, unverified
 * against a real API), `ConsoleMailerAdapter` is fully verified and
 * fully functional for local dev — the entire signup→invite→accept and
 * forgot-password→reset flow is completable end to end by reading a
 * link off the server console, zero external dependency. A real
 * SMTP/API adapter is an explicit, flagged future addition (see
 * CLAUDE.md), not built this pass since there's no real provider
 * credential to verify it against yet.
 */
export interface MailerPort {
  sendPasswordResetEmail(to: string, resetUrl: string): Promise<void>;
  sendCompanyInviteEmail(
    to: string,
    companyName: string,
    inviteUrl: string,
    invitedByEmail: string,
  ): Promise<void>;
}

export const MAILER_PORT = Symbol('MAILER_PORT');

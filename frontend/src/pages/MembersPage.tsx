import { useState } from 'react';
import type { Member, MembershipRole, PendingInvite } from '../api/types';
import {
  useInviteMember,
  useMemberships,
  useRemoveMember,
  useRevokeInvite,
  useUpdateMemberRole,
} from '../api/queries';
import { ApiError } from '../api/client';
import { useAppContext } from '../context/appContextStore';
import { useAuth } from '../context/authContextStore';
import { SettingsBackLink } from '../components/layout/SettingsBackLink';

const ROLE_LABEL: Record<MembershipRole, string> = {
  OWNER: 'Propriétaire',
  MEMBER: 'Membre',
  READ_ONLY: 'Lecture seule',
};

const ROLE_DESCRIPTION: Record<MembershipRole, string> = {
  OWNER: 'Accès complet, y compris la gestion des membres',
  MEMBER: 'Peut saisir, valider et modifier les données',
  READ_ONLY: 'Consultation et export uniquement',
};

/**
 * Member/invite management for the CURRENT company — see CLAUDE.md
 * "Multi-user / roles & permissions". Reachable from Paramètres, same
 * "lightweight admin screen" convention as Comptes & journaux / TVA —
 * Taux, gated on the caller's own OWNER role (see SettingsPage.tsx's
 * own card). The backend independently enforces the same OWNER-only
 * rule on every mutating call here — this page's own gating is a UX
 * nicety, not the real access control.
 */
export function MembersPage() {
  const { currentCompany } = useAppContext();
  const { user } = useAuth();
  const membershipsQuery = useMemberships();
  const inviteMember = useInviteMember();
  const revokeInvite = useRevokeInvite();
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MembershipRole>('MEMBER');
  const [error, setError] = useState<string[] | null>(null);

  const members = membershipsQuery.data?.members ?? [];
  const pendingInvites = membershipsQuery.data?.pendingInvites ?? [];
  const canInvite = inviteEmail.trim() !== '' && !inviteMember.isPending;

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!canInvite) return;
    setError(null);
    try {
      await inviteMember.mutateAsync({ email: inviteEmail.trim(), role: inviteRole });
      setInviteEmail('');
      setInviteRole('MEMBER');
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ["L'invitation a échoué."]);
    }
  }

  async function handleRoleChange(membershipId: string, role: MembershipRole) {
    setError(null);
    try {
      await updateRole.mutateAsync({ membershipId, role });
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ['Le changement de rôle a échoué.']);
    }
  }

  async function handleRemove(member: Member) {
    if (!window.confirm(`Retirer ${member.email} de cette société ?`)) return;
    setError(null);
    try {
      await removeMember.mutateAsync(member.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ['La suppression a échoué.']);
    }
  }

  async function handleRevokeInvite(invite: PendingInvite) {
    setError(null);
    try {
      await revokeInvite.mutateAsync(invite.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ["L'annulation a échoué."]);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-8 py-8">
      <SettingsBackLink />
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Membres</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          {currentCompany?.name ? `Membres de « ${currentCompany.name} ».` : 'Gérer les membres de cette société.'}
        </p>
      </header>

      {error && (
        <div className="rounded-md bg-negative-soft px-4 py-2.5 text-[13px] text-negative">
          {error.map((message, i) => (
            <div key={i}>{message}</div>
          ))}
        </div>
      )}

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-card">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Inviter un membre
        </h2>
        <form onSubmit={(e) => void handleInvite(e)} className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              E-mail
            </span>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="collegue@exemple.com"
              className="rounded-md border border-border bg-bg px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Rôle
            </span>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as MembershipRole)}
              className="rounded-md border border-border bg-bg px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
            >
              {(Object.keys(ROLE_LABEL) as MembershipRole[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={!canInvite}
            className="rounded-md bg-accent px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
          >
            {inviteMember.isPending ? 'Envoi…' : 'Inviter'}
          </button>
        </form>
        <p className="text-[11.5px] text-ink-faint">{ROLE_DESCRIPTION[inviteRole]}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Membres actuels
        </h2>
        <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {membershipsQuery.isLoading ? (
                <tr>
                  <td className="px-4 py-4 text-ink-faint">Chargement…</td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-ink-faint">Aucun membre.</td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr key={member.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 text-ink">
                      {member.email}
                      {member.userId === user?.id && (
                        <span className="ml-2 text-[11.5px] text-ink-faint">(vous)</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={member.role}
                        onChange={(e) => void handleRoleChange(member.id, e.target.value as MembershipRole)}
                        className="rounded-md border border-border bg-bg px-2 py-1 text-[12.5px] text-ink outline-none focus:border-accent"
                      >
                        {(Object.keys(ROLE_LABEL) as MembershipRole[]).map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABEL[role]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => void handleRemove(member)}
                        className="text-[12.5px] font-medium text-negative hover:underline"
                      >
                        Retirer
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {pendingInvites.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Invitations en attente
          </h2>
          <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            <table className="w-full border-collapse text-[13px]">
              <tbody>
                {pendingInvites.map((invite) => (
                  <tr key={invite.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 text-ink">{invite.email}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{ROLE_LABEL[invite.role]}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => void handleRevokeInvite(invite)}
                        className="text-[12.5px] font-medium text-ink-muted hover:text-negative hover:underline"
                      >
                        Annuler
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

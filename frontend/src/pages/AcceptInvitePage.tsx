import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/authContextStore';
import { ApiError } from '../api/client';
import { AuthError, AuthField, AuthInput, AuthLayout, AuthSubmitButton } from '../components/auth/AuthLayout';

/**
 * The frontend can't know ahead of time whether the invited email
 * already has an account (no invite-lookup endpoint exists — see
 * CLAUDE.md "Multi-user / roles & permissions"), so the password field
 * is always shown but optional: an existing account ignores it, a new
 * one requires it (the backend 400s with a clear message if omitted,
 * surfaced the same way any other form error is).
 */
export function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string[] | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setPending(true);
    try {
      await acceptInvite(token, password || undefined);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ["L'invitation n'a pas pu être acceptée."]);
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Invitation invalide">
        <AuthError messages={['Ce lien d’invitation est incomplet ou invalide.']} />
        <Link to="/login" className="text-[13px] font-medium text-accent hover:text-accent-hover">
          Aller à la connexion
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Rejoindre la société"
      subtitle="Si vous n'avez pas encore de compte, choisissez un mot de passe pour en créer un."
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
        <AuthError messages={error} />
        <AuthField label="Mot de passe (nouveau compte uniquement)">
          <AuthInput
            type="password"
            autoFocus
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Laissez vide si vous avez déjà un compte"
          />
        </AuthField>
        <AuthSubmitButton pending={pending}>Accepter l'invitation</AuthSubmitButton>
      </form>
    </AuthLayout>
  );
}

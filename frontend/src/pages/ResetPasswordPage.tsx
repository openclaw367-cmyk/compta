import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authRequest, ApiError } from '../api/client';
import { AuthError, AuthField, AuthInput, AuthLayout, AuthSubmitButton } from '../components/auth/AuthLayout';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string[] | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setPending(true);
    try {
      await authRequest('/auth/reset-password', { token, newPassword });
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ['Une erreur est survenue.']);
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Lien invalide">
        <AuthError messages={['Ce lien de réinitialisation est incomplet ou invalide.']} />
        <Link to="/mot-de-passe-oublie" className="text-[13px] font-medium text-accent hover:text-accent-hover">
          Redemander un lien
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Nouveau mot de passe" subtitle="Choisissez un nouveau mot de passe.">
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
        <AuthError messages={error} />
        <AuthField label="Nouveau mot de passe">
          <AuthInput
            type="password"
            autoFocus
            required
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="8 caractères minimum"
          />
        </AuthField>
        <AuthSubmitButton pending={pending} disabled={newPassword.length < 8}>
          Réinitialiser le mot de passe
        </AuthSubmitButton>
      </form>
    </AuthLayout>
  );
}

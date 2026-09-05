import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authRequest, ApiError } from '../api/client';
import { AuthError, AuthField, AuthInput, AuthLayout, AuthSubmitButton } from '../components/auth/AuthLayout';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string[] | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await authRequest('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ['Une erreur est survenue.']);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout
      title="Mot de passe oublié"
      subtitle="Indiquez votre e-mail — nous vous enverrons un lien de réinitialisation."
      footer={
        <Link to="/login" className="font-medium text-accent hover:text-accent-hover">
          ← Retour à la connexion
        </Link>
      }
    >
      {sent ? (
        <div className="rounded-md bg-positive-soft px-3.5 py-2.5 text-[13px] text-positive">
          Si un compte existe pour « {email} », un lien de réinitialisation vient de lui être
          envoyé.
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <AuthError messages={error} />
          <AuthField label="Adresse e-mail">
            <AuthInput
              type="email"
              autoFocus
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@exemple.com"
            />
          </AuthField>
          <AuthSubmitButton pending={pending}>Envoyer le lien</AuthSubmitButton>
        </form>
      )}
    </AuthLayout>
  );
}

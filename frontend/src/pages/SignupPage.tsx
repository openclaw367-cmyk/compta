import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/authContextStore';
import { ApiError } from '../api/client';
import { AuthError, AuthField, AuthInput, AuthLayout, AuthSubmitButton } from '../components/auth/AuthLayout';

/**
 * One form, three fields — email + password + company name — mirrors
 * CreateCompanyPage.tsx's own only-required field. Landing directly in a
 * working company with zero extra clicks is the frictionless-onboarding
 * requirement (see CLAUDE.md "Multi-user / roles & permissions"); the
 * fuller company profile (SIREN, address, jurisdiction, ...) stays
 * exactly where it already lives, editable later via the company
 * profile screen.
 */
export function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string[] | null>(null);

  const canSubmit = email.trim() !== '' && password.length >= 8 && companyName.trim() !== '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setPending(true);
    try {
      await signup(email, password, companyName.trim());
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ["L'inscription a échoué."]);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout
      title="Créer un compte"
      subtitle="Votre société est créée en même temps que votre compte, prête à l'emploi."
      footer={
        <>
          Déjà un compte ?{' '}
          <Link to="/login" className="font-medium text-accent hover:text-accent-hover">
            Se connecter
          </Link>
        </>
      }
    >
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
        <AuthField label="Mot de passe">
          <AuthInput
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8 caractères minimum"
          />
        </AuthField>
        <AuthField label="Nom de la société">
          <AuthInput
            type="text"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Ma Société SARL"
          />
        </AuthField>
        <AuthSubmitButton pending={pending} disabled={!canSubmit}>
          Créer mon compte
        </AuthSubmitButton>
      </form>
    </AuthLayout>
  );
}

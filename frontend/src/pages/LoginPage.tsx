import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/authContextStore';
import { ApiError } from '../api/client';
import { AuthError, AuthField, AuthInput, AuthLayout, AuthSubmitButton } from '../components/auth/AuthLayout';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string[] | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.details : ['La connexion a échoué.']);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout
      title="Connexion"
      subtitle="Accédez à votre comptabilité."
      footer={
        <>
          Pas encore de compte ?{' '}
          <Link to="/signup" className="font-medium text-accent hover:text-accent-hover">
            Créer un compte
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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </AuthField>
        <div className="-mt-1 text-right">
          <Link to="/mot-de-passe-oublie" className="text-[12.5px] text-ink-muted hover:text-accent">
            Mot de passe oublié ?
          </Link>
        </div>
        <AuthSubmitButton pending={pending}>Se connecter</AuthSubmitButton>
      </form>
    </AuthLayout>
  );
}

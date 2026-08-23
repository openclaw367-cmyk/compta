import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useCloudCredentials,
  useRevokeCloudCredential,
  useSetCloudCredential,
} from '../api/queries';
import type { CloudProvider } from '../api/types';
import { ApiError } from '../api/client';

const PROVIDER_LABELS: Record<CloudProvider, string> = {
  CLAUDE: 'Claude (Anthropic)',
  DEEPSEEK: 'DeepSeek',
};

/**
 * Consent copy, verbatim from the approved design
 * (specs/ai-chatbot-cloud-tier-implementation-spec.md, "Consent copy").
 * Each residency/DPA claim was verified against the provider's own
 * current primary-source policy pages before being written — do not
 * paraphrase or "simplify" this text without re-verifying against those
 * sources first; a misstated residency line is worse than none.
 */
const CONSENT_COPY: Record<
  CloudProvider,
  { title: string; body: string[]; checkbox: string; policyUrl: string; policyLabel: string }
> = {
  DEEPSEEK: {
    title: 'Activer les propositions via DeepSeek ?',
    body: [
      'En activant cette option, le contenu des factures que vous joignez (texte complet du ' +
        "document, montants, TVA, dates) ainsi que les identifiants d'exercices et de journaux " +
        'de votre dossier seront envoyés aux serveurs de DeepSeek, en dehors de cet ordinateur, ' +
        "afin de générer une proposition d'écriture fiable. Le solde de vos comptes et " +
        "l'historique de votre comptabilité ne sont jamais transmis. Chaque envoi est " +
        'déclenché explicitement par vous via le bouton « ☁️ Proposer avec DeepSeek » — ' +
        "l'assistant reste 100 % local pour toutes les autres questions.",
      "DeepSeek (Hangzhou DeepSeek Artificial Intelligence Co., Ltd.) stocke et traite ces " +
        "données en République populaire de Chine, un pays sans décision d'adéquation " +
        "RGPD. Les conditions d'utilisation de DeepSeek indiquent qu'elles peuvent être " +
        "utilisées pour améliorer ses services, sans mécanisme de retrait documenté " +
        "spécifique à l'API. Consultez sa politique de confidentialité avant d'activer.",
    ],
    checkbox:
      "J'ai compris que ces données quittent l'Union européenne, peuvent être utilisées par " +
      "DeepSeek pour améliorer ses services, et j'accepte de les envoyer.",
    policyUrl: 'https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html',
    policyLabel: 'Politique de confidentialité de DeepSeek',
  },
  CLAUDE: {
    title: 'Activer les propositions via Claude (Anthropic) ?',
    body: [
      'En activant cette option, le contenu des factures que vous joignez (texte complet du ' +
        "document, montants, TVA, dates) ainsi que les identifiants d'exercices et de journaux " +
        "de votre dossier seront envoyés aux serveurs d'Anthropic, en dehors de cet ordinateur, " +
        "afin de générer une proposition d'écriture fiable. Le solde de vos comptes et " +
        "l'historique de votre comptabilité ne sont jamais transmis. Chaque envoi est " +
        'déclenché explicitement par vous via le bouton « ☁️ Proposer avec Claude » — ' +
        "l'assistant reste 100 % local pour toutes les autres questions.",
      'Anthropic traite ces données conformément à son Data Processing Addendum (clauses ' +
        "contractuelles types incluses) et n'entraîne pas ses modèles sur le contenu envoyé " +
        "via l'API. Les données sont stockées aux États-Unis (pas de résidence des données " +
        "dans l'UE sur cette offre). Consultez sa politique de confidentialité avant d'activer.",
    ],
    checkbox:
      "J'ai compris que ces données quittent cet ordinateur (stockées aux États-Unis) et " +
      "j'accepte de les envoyer à Anthropic.",
    policyUrl: 'https://privacy.claude.com/',
    policyLabel: "Centre de confidentialité d'Anthropic",
  },
};

/**
 * Settings for the cloud tier's write path (see CLAUDE.md "AI chatbot
 * cloud tier"). Reachable only via a link from AssistantPage — there is
 * no sidebar entry, since this is a sub-concern of the assistant, not a
 * general app setting. Cloud stays off by default: this page only ever
 * shows real, already-persisted `CloudModelCredential` rows (via
 * CloudCredentialsService, never the plaintext key) plus the explicit
 * consent flow to add one.
 */
export function AssistantSettingsPage() {
  const credentials = useCloudCredentials();
  const revokeCredential = useRevokeCloudCredential();
  const [dialogProvider, setDialogProvider] = useState<CloudProvider | null>(null);

  const configured = new Map((credentials.data ?? []).map((c) => [c.provider, c] as const));

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Link to="/assistant" className="text-[12.5px] text-ink-muted hover:text-ink">
        ← Retour à l'assistant
      </Link>
      <h1 className="mt-2 text-[20px] font-semibold tracking-tight text-ink">
        Assistant IA — fournisseurs cloud (optionnel)
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
        Par défaut, l'assistant est <strong className="text-ink">100 % local</strong> : rien de
        vos données comptables ne quitte cet ordinateur. Vous pouvez, si vous le souhaitez,
        activer un fournisseur cloud spécifiquement pour la proposition d'écriture à partir
        d'une facture — jamais pour les autres questions, et jamais automatiquement. Un badge (🔒
        Local / ☁️ fournisseur) reste visible sur chaque message et chaque proposition, pour que
        vous sachiez toujours si des données ont quitté cet ordinateur.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        {(['CLAUDE', 'DEEPSEEK'] as const).map((provider) => {
          const cred = configured.get(provider);
          return (
            <div key={provider} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[14px] font-medium text-ink">
                    {PROVIDER_LABELS[provider]}
                  </div>
                  {cred ? (
                    <div className="mt-0.5 font-mono text-[12.5px] text-ink-muted">
                      Clé configurée — {cred.maskedKey}
                    </div>
                  ) : (
                    <div className="mt-0.5 text-[12.5px] text-ink-faint">Non configuré</div>
                  )}
                </div>
                {cred ? (
                  <button
                    type="button"
                    onClick={() => void revokeCredential.mutateAsync(provider)}
                    disabled={revokeCredential.isPending}
                    className="shrink-0 rounded-md border border-negative px-3 py-1.5 text-[12.5px] text-negative hover:bg-negative-soft disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Révoquer
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDialogProvider(provider)}
                    className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-accent-hover"
                  >
                    Activer…
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {dialogProvider && (
        <ConsentDialog provider={dialogProvider} onClose={() => setDialogProvider(null)} />
      )}
    </div>
  );
}

function ConsentDialog({
  provider,
  onClose,
}: {
  provider: CloudProvider;
  onClose: () => void;
}) {
  const copy = CONSENT_COPY[provider];
  const setCredential = useSetCloudCredential();
  const [checked, setChecked] = useState(false);
  const [step, setStep] = useState<'consent' | 'key'>('consent');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    try {
      await setCredential.mutateAsync({ provider, apiKey: trimmed });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.details.join(' ') : "L'enregistrement a échoué.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-consent-title"
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {step === 'consent' ? (
          <>
            <h2 id="cloud-consent-title" className="text-[15px] font-semibold text-ink">
              {copy.title}
            </h2>
            <div className="mt-3 flex flex-col gap-3 text-[12.5px] leading-relaxed text-ink-muted">
              {copy.body.map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
            <a
              href={copy.policyUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-[12px] text-accent hover:text-accent-hover"
            >
              {copy.policyLabel} ↗
            </a>
            <label className="mt-4 flex items-start gap-2 rounded-md bg-warning-soft p-2.5 text-[12.5px] text-warning">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="mt-0.5 shrink-0"
              />
              <span className="italic">{copy.checkbox}</span>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-3.5 py-2 text-[12.5px] text-ink-muted hover:bg-bg"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={!checked}
                onClick={() => setStep('key')}
                className="rounded-md bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
              >
                Activer
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-[15px] font-semibold text-ink">
              Clé API — {PROVIDER_LABELS[provider]}
            </h2>
            <p className="mt-2 text-[12.5px] text-ink-muted">
              Elle est chiffrée et n'est jamais réaffichée en clair une fois enregistrée — voir
              CLAUDE.md « AI chatbot cloud tier » pour ce que ce chiffrement protège réellement.
            </p>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
            />
            {error && <div className="mt-2 text-[12px] text-negative">{error}</div>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-3.5 py-2 text-[12.5px] text-ink-muted hover:bg-bg"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={!apiKey.trim() || setCredential.isPending}
                onClick={() => void handleSave()}
                className="rounded-md bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {setCredential.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

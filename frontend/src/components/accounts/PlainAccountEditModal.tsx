import { useState } from 'react';
import type { Account } from '../../api/types';
import { ApiError } from '../../api/client';

const INPUT_CLASS =
  'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent';
const LABEL_CLASS = 'flex flex-col gap-1 text-[12px] font-medium text-ink-muted';

/**
 * Edit a plain (non-auxiliary) PCG account's number and/or label — the
 * Plan Comptable module's own edit action (2026-09-06). Tiers get their
 * own, fuller identity form (TiersFormModal); this one is deliberately
 * minimal (number + label only) since address/SIREN/VAT are meaningless
 * for a plain account. Number is fully editable — the backend recomputes
 * pcgClass from it and refuses if the account still has tiers underneath
 * it (see AccountsService.rename()).
 */
export function PlainAccountEditModal({
  account,
  onSubmit,
  onClose,
}: {
  account: Account;
  onSubmit: (values: { label: string; number: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(account.label);
  const [number, setNumber] = useState(account.number);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = label.trim() !== '' && /^[1-8]/.test(number.trim());

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({ label: label.trim(), number: number.trim() });
    } catch (err) {
      setError(err instanceof ApiError ? err.details.join(' ') : "L'enregistrement a échoué.");
      setSubmitting(false);
    }
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plain-account-edit-title"
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="plain-account-edit-title" className="text-[15px] font-semibold text-ink">
          Modifier le compte
        </h2>

        <div className="mt-4 flex flex-col gap-3">
          <label className={LABEL_CLASS}>
            N° de compte
            <input
              autoFocus
              type="text"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="622100"
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </label>
          <label className={LABEL_CLASS}>
            Libellé
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Honoraires"
              className={INPUT_CLASS}
            />
          </label>
        </div>

        {error && <p className="mt-3 text-[12px] text-negative">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3.5 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-bg"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={!canSubmit || submitting}
            onClick={() => void handleSubmit()}
            className="rounded-md bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
          >
            {submitting ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

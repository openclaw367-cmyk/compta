import { useState } from 'react';
import type { Account } from '../../api/types';
import { ApiError } from '../../api/client';

export interface TiersFormValues {
  label: string;
  addressLine?: string;
  postalCode?: string;
  city?: string;
  countryCode?: string;
  sirenOrRci?: string;
  vatNumber?: string;
}

interface TiersFormDraft {
  label: string;
  addressLine: string;
  postalCode: string;
  city: string;
  countryCode: string;
  sirenOrRci: string;
  vatNumber: string;
}

function draftFromAccount(account: Account | null, defaultCountryCode: string): TiersFormDraft {
  return {
    label: account?.label ?? '',
    addressLine: account?.addressLine ?? '',
    postalCode: account?.postalCode ?? '',
    city: account?.city ?? '',
    countryCode: account?.countryCode ?? defaultCountryCode,
    sirenOrRci: account?.sirenOrRci ?? '',
    vatNumber: account?.vatNumber ?? '',
  };
}

function optional(value: string): string | undefined {
  return value.trim() === '' ? undefined : value.trim();
}

const INPUT_CLASS =
  'w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent';
const LABEL_CLASS = 'flex flex-col gap-1 text-[12px] font-medium text-ink-muted';

/**
 * The full tiers-identity form — name, address, SIREN/RCI, VAT number —
 * shared by "+ Nouveau tiers" (create) and "Modifier" (edit) on
 * CollectifTiersCard. Capturing these once here is what lets
 * InvoiceEditor pre-fill a client's own finalize/devis fields instead of
 * asking for them again on every invoice — see CLAUDE.md "Invoicing".
 * Deliberately NOT reused by the quick inline "+ nouveau tiers" creation
 * elsewhere (e.g. the journal-entry grid's own CompAux picker) — that
 * flow stays a fast, name-only prompt, since full legal details aren't
 * the point when posting a journal entry.
 */
export function TiersFormModal({
  mode,
  account,
  collectifNumber,
  defaultCountryCode,
  onSubmit,
  onClose,
}: {
  mode: 'create' | 'edit';
  /** The tiers being edited, or null when creating. */
  account: Account | null;
  /** The parent collectif's own number — only used for the create-mode "number assigned automatically" hint. */
  collectifNumber?: string;
  /** Pre-fills the country field for a brand-new tiers — typically the current company's own jurisdiction. */
  defaultCountryCode: string;
  onSubmit: (values: TiersFormValues) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TiersFormDraft>(() =>
    draftFromAccount(account, defaultCountryCode),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function patch(fields: Partial<TiersFormDraft>) {
    setDraft((prev) => ({ ...prev, ...fields }));
  }

  async function handleSubmit() {
    if (draft.label.trim() === '') return;
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        label: draft.label.trim(),
        addressLine: optional(draft.addressLine),
        postalCode: optional(draft.postalCode),
        city: optional(draft.city),
        countryCode: optional(draft.countryCode),
        sirenOrRci: optional(draft.sirenOrRci),
        vatNumber: optional(draft.vatNumber),
      });
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
        aria-labelledby="tiers-form-title"
        className="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="tiers-form-title" className="text-[15px] font-semibold text-ink">
          {mode === 'create' ? 'Nouveau tiers' : 'Modifier le tiers'}
        </h2>
        {mode === 'create' && collectifNumber && (
          <p className="mt-1 text-[12px] text-ink-faint">
            Le numéro sera attribué automatiquement ({collectifNumber.slice(0, 3)}00X).
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className={`col-span-2 ${LABEL_CLASS}`}>
            Nom
            <input
              autoFocus
              type="text"
              value={draft.label}
              onChange={(e) => patch({ label: e.target.value })}
              placeholder="Client Petit SARL"
              className={INPUT_CLASS}
            />
          </label>
          <label className={`col-span-2 ${LABEL_CLASS}`}>
            Adresse
            <input
              type="text"
              value={draft.addressLine}
              onChange={(e) => patch({ addressLine: e.target.value })}
              placeholder="5 avenue des Champs"
              className={INPUT_CLASS}
            />
          </label>
          <label className={LABEL_CLASS}>
            Code postal
            <input
              type="text"
              value={draft.postalCode}
              onChange={(e) => patch({ postalCode: e.target.value })}
              placeholder="75008"
              className={INPUT_CLASS}
            />
          </label>
          <label className={LABEL_CLASS}>
            Ville
            <input
              type="text"
              value={draft.city}
              onChange={(e) => patch({ city: e.target.value })}
              placeholder="Paris"
              className={INPUT_CLASS}
            />
          </label>
          <label className={LABEL_CLASS}>
            Pays (ISO)
            <input
              type="text"
              value={draft.countryCode}
              onChange={(e) => patch({ countryCode: e.target.value.toUpperCase().slice(0, 2) })}
              placeholder="FR"
              className={INPUT_CLASS}
            />
          </label>
          <label className={LABEL_CLASS}>
            SIREN / RCI
            <input
              type="text"
              value={draft.sirenOrRci}
              onChange={(e) => patch({ sirenOrRci: e.target.value })}
              placeholder="123456789"
              className={INPUT_CLASS}
            />
          </label>
          <label className={`col-span-2 ${LABEL_CLASS}`}>
            N° TVA intracommunautaire
            <input
              type="text"
              value={draft.vatNumber}
              onChange={(e) => patch({ vatNumber: e.target.value })}
              placeholder="FR98987654321"
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
            disabled={draft.label.trim() === '' || submitting}
            onClick={() => void handleSubmit()}
            className="rounded-md bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
          >
            {submitting ? 'Enregistrement…' : mode === 'create' ? 'Créer' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

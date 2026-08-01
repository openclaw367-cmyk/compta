import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useCompany, useUpdateCompany } from '../api/queries';
import type { UpdateCompanyDto } from '../api/dto';
import { ApiError } from '../api/client';
import type { Company } from '../api/types';

interface Draft {
  name: string;
  jurisdiction: 'FR' | 'MC';
  siren: string;
  rci: string;
  vatNumber: string;
  addressLine: string;
  postalCode: string;
  city: string;
  country: string;
}

function toDraft(company: Company): Draft {
  return {
    name: company.name,
    jurisdiction: company.jurisdiction,
    siren: company.siren ?? '',
    rci: company.rci ?? '',
    vatNumber: company.vatNumber ?? '',
    addressLine: company.addressLine ?? '',
    postalCode: company.postalCode ?? '',
    city: company.city ?? '',
    country: company.country,
  };
}

function optional(value: string): string | undefined {
  return value.trim() === '' ? undefined : value.trim();
}

export function CompanyProfilePage() {
  const companyQuery = useCompany();
  const updateCompany = useUpdateCompany();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (companyQuery.data && !editing) setDraft(toDraft(companyQuery.data));
  }, [companyQuery.data, editing]);

  function startEditing() {
    if (companyQuery.data) setDraft(toDraft(companyQuery.data));
    setError(null);
    setEditing(true);
  }

  function cancelEditing() {
    if (companyQuery.data) setDraft(toDraft(companyQuery.data));
    setError(null);
    setEditing(false);
  }

  async function handleSave() {
    if (!draft) return;
    if (draft.name.trim() === '') {
      setError('Le nom de la société est obligatoire.');
      return;
    }
    if (
      companyQuery.data &&
      draft.jurisdiction !== companyQuery.data.jurisdiction &&
      !window.confirm(
        `Changer la juridiction de ${companyQuery.data.jurisdiction} vers ${draft.jurisdiction} ? ` +
          "Ce champ pilote les règles de conformité appliquées (plan comptable, TVA, formats " +
          "d'export) — à ne changer que si la société a réellement changé de juridiction.",
      )
    ) {
      return;
    }
    setError(null);
    const dto: UpdateCompanyDto = {
      name: draft.name.trim(),
      jurisdiction: draft.jurisdiction,
      siren: optional(draft.siren),
      rci: optional(draft.rci),
      vatNumber: optional(draft.vatNumber),
      addressLine: optional(draft.addressLine),
      postalCode: optional(draft.postalCode),
      city: optional(draft.city),
      country: optional(draft.country),
    };
    try {
      await updateCompany.mutateAsync(dto);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.details.join(' ') : "L'enregistrement a échoué.");
    }
  }

  if (companyQuery.isLoading || !draft) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ink-faint">
        Chargement…
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-8 py-8">
      <header className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">Société</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            Profil de la société — identité, identifiants fiscaux et adresse.
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={startEditing}
            className="ml-auto rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover"
          >
            Modifier
          </button>
        )}
      </header>

      {error && (
        <div className="rounded-md bg-negative-soft px-4 py-2.5 text-[13px] text-negative">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5">
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Identité
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <Row label="Nom">
              {editing ? (
                <TextInput
                  value={draft.name}
                  onChange={(v) => setDraft({ ...draft, name: v })}
                  autoFocus
                />
              ) : (
                <Value>{companyQuery.data?.name}</Value>
              )}
            </Row>
            <Row label="Juridiction">
              {editing ? (
                <select
                  value={draft.jurisdiction}
                  onChange={(e) =>
                    setDraft({ ...draft, jurisdiction: e.target.value as 'FR' | 'MC' })
                  }
                  className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                >
                  <option value="FR">France</option>
                  <option value="MC">Monaco</option>
                </select>
              ) : (
                <Value>
                  {companyQuery.data?.jurisdiction === 'MC' ? 'Monaco' : 'France'}
                </Value>
              )}
            </Row>
          </div>
        </section>

        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Identifiants
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <Row label="SIREN" hint="Requis pour générer l'export FEC.">
              {editing ? (
                <TextInput
                  value={draft.siren}
                  onChange={(v) => setDraft({ ...draft, siren: v })}
                  placeholder="123456789"
                />
              ) : (
                <Value>{companyQuery.data?.siren}</Value>
              )}
            </Row>
            <Row label="RCI (Monaco)">
              {editing ? (
                <TextInput
                  value={draft.rci}
                  onChange={(v) => setDraft({ ...draft, rci: v })}
                />
              ) : (
                <Value>{companyQuery.data?.rci}</Value>
              )}
            </Row>
            <Row label="N° TVA intracommunautaire">
              {editing ? (
                <TextInput
                  value={draft.vatNumber}
                  onChange={(v) => setDraft({ ...draft, vatNumber: v })}
                  placeholder="FR12123456789"
                />
              ) : (
                <Value>{companyQuery.data?.vatNumber}</Value>
              )}
            </Row>
          </div>
        </section>

        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Adresse
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <Row label="Adresse" span2>
              {editing ? (
                <TextInput
                  value={draft.addressLine}
                  onChange={(v) => setDraft({ ...draft, addressLine: v })}
                  placeholder="12 rue de la Paix"
                />
              ) : (
                <Value>{companyQuery.data?.addressLine}</Value>
              )}
            </Row>
            <Row label="Code postal">
              {editing ? (
                <TextInput
                  value={draft.postalCode}
                  onChange={(v) => setDraft({ ...draft, postalCode: v })}
                  placeholder="75002"
                />
              ) : (
                <Value>{companyQuery.data?.postalCode}</Value>
              )}
            </Row>
            <Row label="Ville">
              {editing ? (
                <TextInput
                  value={draft.city}
                  onChange={(v) => setDraft({ ...draft, city: v })}
                  placeholder="Paris"
                />
              ) : (
                <Value>{companyQuery.data?.city}</Value>
              )}
            </Row>
            <Row label="Pays">
              {editing ? (
                <TextInput
                  value={draft.country}
                  onChange={(v) => setDraft({ ...draft, country: v })}
                />
              ) : (
                <Value>{companyQuery.data?.country}</Value>
              )}
            </Row>
          </div>
        </section>

        {editing && (
          <div className="flex items-center gap-2 border-t border-border pt-4">
            <button
              type="button"
              disabled={updateCompany.isPending}
              onClick={() => void handleSave()}
              className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
            >
              {updateCompany.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              className="rounded-md px-3.5 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-bg"
            >
              Annuler
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  span2,
  children,
}: {
  label: string;
  hint?: string;
  span2?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={['flex flex-col gap-1', span2 ? 'col-span-2' : ''].join(' ')}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      {children}
      {hint && <span className="text-[11.5px] text-ink-faint">{hint}</span>}
    </label>
  );
}

function Value({ children }: { children?: string | null }) {
  return <span className="text-[13.5px] text-ink">{children && children !== '' ? children : '—'}</span>;
}

function TextInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type="text"
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
    />
  );
}

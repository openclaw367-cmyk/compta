import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateCompany, useCreateFiscalYear } from '../api/queries';
import type { CreateCompanyDto, CreateFiscalYearDto } from '../api/dto';
import type { Company } from '../api/types';
import { ApiError } from '../api/client';
import { useAppContext } from '../context/appContextStore';
import { SettingsBackLink } from '../components/layout/SettingsBackLink';

interface CompanyDraft {
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

function emptyCompanyDraft(): CompanyDraft {
  return {
    name: '',
    jurisdiction: 'FR',
    siren: '',
    rci: '',
    vatNumber: '',
    addressLine: '',
    postalCode: '',
    city: '',
    country: 'France',
  };
}

function optional(value: string): string | undefined {
  return value.trim() === '' ? undefined : value.trim();
}

function emptyFiscalYearDraft(): CreateFiscalYearDto {
  return { label: '', startDate: '', endDate: '' };
}

/**
 * Two steps, both reusing existing fields and existing write endpoints —
 * no parallel scaffolding logic on the frontend:
 *
 * 1. Company identity — the exact fields CompanyProfilePage already
 *    edits, POSTed to the newly-scaffolded-server-side create() (see
 *    CompaniesService.create() for the chart-of-accounts/journals
 *    scaffolding itself — nothing about that happens here).
 * 2. First fiscal year — the exact fields FiscalYearsPage already
 *    creates, via the SAME useCreateFiscalYear() hook that screen uses.
 *    Skippable ("Plus tard") — Dashboard already has a graceful
 *    "no fiscal year" banner, so this isn't a hard blocker.
 */
export function CreateCompanyPage() {
  const navigate = useNavigate();
  const { companyId, setCompanyId } = useAppContext();
  const createCompany = useCreateCompany();
  const createFiscalYear = useCreateFiscalYear();

  const [createdCompany, setCreatedCompany] = useState<Company | null>(null);
  const [companyDraft, setCompanyDraft] = useState<CompanyDraft>(emptyCompanyDraft());
  const [companyError, setCompanyError] = useState<string[] | null>(null);

  const [fyDraft, setFyDraft] = useState<CreateFiscalYearDto>(emptyFiscalYearDraft());
  const [fyError, setFyError] = useState<string | null>(null);

  // setCompanyId() is a React state update, not synchronous — every
  // request (including the fiscal-year creation below) is scoped by the
  // module-level x-company-id client.ts holds, which only catches up
  // once AppProvider's own effect has run. Gating step 2 on this avoids
  // a real race: creating the fiscal year under the PREVIOUS company.
  const contextReady = createdCompany !== null && companyId === createdCompany.id;

  const canCreateCompany = companyDraft.name.trim() !== '';

  async function handleCreateCompany() {
    if (!canCreateCompany) return;
    setCompanyError(null);
    const dto: CreateCompanyDto = {
      name: companyDraft.name.trim(),
      jurisdiction: companyDraft.jurisdiction,
      siren: optional(companyDraft.siren),
      rci: optional(companyDraft.rci),
      vatNumber: optional(companyDraft.vatNumber),
      addressLine: optional(companyDraft.addressLine),
      postalCode: optional(companyDraft.postalCode),
      city: optional(companyDraft.city),
      country: optional(companyDraft.country),
    };
    try {
      const company = await createCompany.mutateAsync(dto);
      setCreatedCompany(company);
      setCompanyId(company.id);
    } catch (error) {
      setCompanyError(error instanceof ApiError ? error.details : ['La création a échoué.']);
    }
  }

  const canCreateFiscalYear =
    fyDraft.label.trim() !== '' &&
    fyDraft.startDate !== '' &&
    fyDraft.endDate !== '' &&
    fyDraft.endDate >= fyDraft.startDate;

  async function handleCreateFiscalYear() {
    if (!canCreateFiscalYear) return;
    setFyError(null);
    try {
      await createFiscalYear.mutateAsync(fyDraft);
      navigate('/tableau-de-bord');
    } catch (error) {
      setFyError(error instanceof ApiError ? error.message : 'La création a échoué.');
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-8 py-8">
      <SettingsBackLink />
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Nouvelle société</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Crée un nouveau dossier — plan comptable et journaux standards inclus, prêt à l'emploi.
        </p>
      </header>

      <StepIndicator activeStep={createdCompany ? 2 : 1} />

      {!createdCompany ? (
        <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 shadow-card">
          {companyError && (
            <div className="rounded-md bg-negative-soft px-4 py-2.5 text-[13px] text-negative">
              {companyError.map((message, i) => (
                <div key={i}>{message}</div>
              ))}
            </div>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Identité
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <Row label="Nom">
                <TextInput
                  autoFocus
                  value={companyDraft.name}
                  onChange={(v) => setCompanyDraft((d) => ({ ...d, name: v }))}
                  placeholder="Ma Société SARL"
                />
              </Row>
              <Row label="Juridiction">
                <select
                  value={companyDraft.jurisdiction}
                  onChange={(e) =>
                    setCompanyDraft((d) => ({
                      ...d,
                      jurisdiction: e.target.value as 'FR' | 'MC',
                    }))
                  }
                  className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                >
                  <option value="FR">France</option>
                  <option value="MC">Monaco</option>
                </select>
              </Row>
            </div>
          </section>

          <section className="flex flex-col gap-3 border-t border-border pt-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Identifiants
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <Row label="SIREN" hint="Requis pour générer l'export FEC.">
                <TextInput
                  value={companyDraft.siren}
                  onChange={(v) => setCompanyDraft((d) => ({ ...d, siren: v }))}
                  placeholder="123456789"
                />
              </Row>
              <Row label="RCI (Monaco)">
                <TextInput
                  value={companyDraft.rci}
                  onChange={(v) => setCompanyDraft((d) => ({ ...d, rci: v }))}
                />
              </Row>
              <Row label="N° TVA intracommunautaire">
                <TextInput
                  value={companyDraft.vatNumber}
                  onChange={(v) => setCompanyDraft((d) => ({ ...d, vatNumber: v }))}
                  placeholder="FR12123456789"
                />
              </Row>
            </div>
          </section>

          <section className="flex flex-col gap-3 border-t border-border pt-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Adresse
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <Row label="Adresse" span2>
                <TextInput
                  value={companyDraft.addressLine}
                  onChange={(v) => setCompanyDraft((d) => ({ ...d, addressLine: v }))}
                  placeholder="12 rue de la Paix"
                />
              </Row>
              <Row label="Code postal">
                <TextInput
                  value={companyDraft.postalCode}
                  onChange={(v) => setCompanyDraft((d) => ({ ...d, postalCode: v }))}
                  placeholder="75002"
                />
              </Row>
              <Row label="Ville">
                <TextInput
                  value={companyDraft.city}
                  onChange={(v) => setCompanyDraft((d) => ({ ...d, city: v }))}
                  placeholder="Paris"
                />
              </Row>
              <Row label="Pays">
                <TextInput
                  value={companyDraft.country}
                  onChange={(v) => setCompanyDraft((d) => ({ ...d, country: v }))}
                />
              </Row>
            </div>
          </section>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              disabled={!canCreateCompany || createCompany.isPending}
              onClick={() => void handleCreateCompany()}
              className="rounded-md bg-accent px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
            >
              {createCompany.isPending ? 'Création…' : 'Créer la société'}
            </button>
          </div>
        </div>
      ) : !contextReady ? (
        <div className="rounded-lg border border-border bg-surface p-5 text-[13px] text-ink-faint shadow-card">
          Configuration en cours…
        </div>
      ) : (
        <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 shadow-card">
          <div className="rounded-md bg-positive-soft px-4 py-2.5 text-[13px] text-positive">
            ✓ « {createdCompany.name} » créée — plan comptable et journaux standards en place.
          </div>

          <section className="flex flex-col gap-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Premier exercice
            </h2>
            <p className="text-[12.5px] text-ink-muted">
              Nécessaire pour saisir des écritures — chaque écran de l'application en dépend.
            </p>
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Libellé">
                <input
                  autoFocus
                  type="text"
                  value={fyDraft.label}
                  onChange={(e) => setFyDraft((d) => ({ ...d, label: e.target.value }))}
                  placeholder="2026"
                  className="w-32 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
                />
              </Field>
              <Field label="Date de début">
                <input
                  type="date"
                  value={fyDraft.startDate}
                  onChange={(e) => setFyDraft((d) => ({ ...d, startDate: e.target.value }))}
                  className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                />
              </Field>
              <Field label="Date de fin">
                <input
                  type="date"
                  value={fyDraft.endDate}
                  onChange={(e) => setFyDraft((d) => ({ ...d, endDate: e.target.value }))}
                  className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                />
              </Field>
            </div>
            {fyError && <p className="text-[12.5px] text-negative">{fyError}</p>}
          </section>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => navigate('/tableau-de-bord')}
              className="rounded-md px-3.5 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-bg"
            >
              Plus tard
            </button>
            <button
              type="button"
              disabled={!canCreateFiscalYear || createFiscalYear.isPending}
              onClick={() => void handleCreateFiscalYear()}
              className="rounded-md bg-accent px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
            >
              {createFiscalYear.isPending ? 'Création…' : "Créer l'exercice"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepIndicator({ activeStep }: { activeStep: 1 | 2 }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px]">
      <StepBadge n={1} label="Société" active={activeStep === 1} done={activeStep > 1} />
      <div className="h-px w-8 bg-border" />
      <StepBadge n={2} label="Premier exercice" active={activeStep === 2} done={false} />
    </div>
  );
}

function StepBadge({
  n,
  label,
  active,
  done,
}: {
  n: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={[
          'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold',
          active
            ? 'bg-accent text-white'
            : done
              ? 'bg-positive-soft text-positive'
              : 'bg-bg text-ink-faint',
        ].join(' ')}
      >
        {done ? '✓' : n}
      </span>
      <span className={active ? 'font-medium text-ink' : 'text-ink-faint'}>{label}</span>
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}

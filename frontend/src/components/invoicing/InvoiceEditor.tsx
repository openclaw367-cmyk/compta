import { useState } from 'react';
import type { Account, Invoice, VatRate } from '../../api/types';
import type { CreateInvoiceDto, DevisRequestDto, FinalizeInvoiceDto } from '../../api/dto';
import {
  useCreateInvoice,
  useDownloadDevis,
  useFinalizeInvoice,
  useUpdateInvoice,
} from '../../api/queries';
import { ApiError } from '../../api/client';
import { AccountCombobox } from '../journal/AccountCombobox';
import { InvoiceLinesEditor } from './InvoiceLinesEditor';
import { emptyInvoiceLine, type DraftInvoiceLine } from '../../lib/invoiceLines';

function isClientAccount(account: Account): boolean {
  return account.number.startsWith('411') && account.isAuxiliary;
}
function isRevenueAccount(account: Account): boolean {
  return account.pcgClass === 7;
}

function linesFromExisting(invoice: Invoice): DraftInvoiceLine[] {
  return invoice.lines.map((l) => ({
    key: `il-${l.id}`,
    description: l.description,
    quantity: l.quantity,
    unitPriceHT: l.unitPriceHT,
    revenueAccountId: l.revenueAccountId,
    vatRateId: l.vatRateId,
  }));
}

/**
 * DRAFT create/edit — see CLAUDE.md "Invoicing — Phase A". Mirrors
 * EcritureEditor's own shape: save-as-draft is always available;
 * finalize() is a SEPARATE, only-on-an-existing-draft action (never
 * offered from the initial "create" flow, same as validate() never
 * being offered from écriture creation) — closing over an id the
 * backend hasn't assigned yet would need speculative-then-replace
 * logic this app doesn't use anywhere else.
 */
export function InvoiceEditor({
  fiscalYearId,
  accounts,
  vatRates,
  existing,
  creditNoteFor,
  onSaved,
  onCancel,
}: {
  fiscalYearId: string;
  accounts: Account[];
  vatRates: VatRate[];
  existing: Invoice | null;
  /** When creating a new CREDIT_NOTE against an already-finalized SALE invoice. */
  creditNoteFor?: Invoice;
  onSaved: (invoice: Invoice) => void;
  onCancel: () => void;
}) {
  const clientAccounts = accounts.filter(isClientAccount);
  const revenueAccounts = accounts.filter(isRevenueAccount);

  const [clientAccountId, setClientAccountId] = useState<string | null>(
    existing?.clientAccountId ?? creditNoteFor?.clientAccountId ?? null,
  );
  const [lines, setLines] = useState<DraftInvoiceLine[]>(
    existing ? linesFromExisting(existing) : [emptyInvoiceLine()],
  );
  const [error, setError] = useState<string | null>(null);

  const createInvoice = useCreateInvoice();
  const updateInvoice = useUpdateInvoice();
  const isSaving = createInvoice.isPending || updateInvoice.isPending;

  const isDraftEditable = !existing || existing.status === 'DRAFT';
  const canSave =
    Boolean(clientAccountId) &&
    lines.length > 0 &&
    lines.every((l) => l.description.trim() !== '' && l.revenueAccountId && l.unitPriceHT !== '');

  async function handleSave() {
    if (!clientAccountId) return;
    setError(null);
    const dto: CreateInvoiceDto = {
      fiscalYearId,
      type: creditNoteFor ? 'CREDIT_NOTE' : (existing?.type ?? 'SALE'),
      correctsInvoiceId: creditNoteFor?.id ?? existing?.correctsInvoiceId ?? undefined,
      clientAccountId,
      lines: lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPriceHT: l.unitPriceHT,
        revenueAccountId: l.revenueAccountId!,
        vatRateId: l.vatRateId ?? undefined,
      })),
    };
    try {
      const saved = existing
        ? await updateInvoice.mutateAsync({ id: existing.id, dto })
        : await createInvoice.mutateAsync(dto);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "L'enregistrement a échoué.");
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-ink">
          {creditNoteFor
            ? `Nouvel avoir — rectifie la facture n° ${creditNoteFor.invoiceNumber}`
            : existing
              ? `Brouillon ${existing.type === 'CREDIT_NOTE' ? "d'avoir" : 'de facture'}`
              : 'Nouvelle facture'}
        </h2>
        <button type="button" onClick={onCancel} className="text-[13px] text-ink-faint hover:text-ink">
          Annuler
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-negative-soft px-3.5 py-2.5 text-[13px] text-negative">{error}</div>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-[12px] font-medium text-ink-muted">Client</label>
        <AccountCombobox
          accounts={clientAccounts}
          value={clientAccountId}
          onSelect={setClientAccountId}
          placeholder="Sélectionner un client (compte 411…)"
          disabled={!isDraftEditable || Boolean(creditNoteFor)}
        />
      </div>

      <InvoiceLinesEditor
        lines={lines}
        revenueAccounts={revenueAccounts}
        vatRates={vatRates}
        disabled={!isDraftEditable}
        onChange={setLines}
      />

      {isDraftEditable && (
        <div className="flex items-center gap-2 self-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || isSaving}
            className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
          >
            {isSaving ? 'Enregistrement…' : 'Enregistrer le brouillon'}
          </button>
        </div>
      )}

      {existing && existing.status === 'DRAFT' && !creditNoteFor && (
        <DevisSection invoice={existing} />
      )}

      {existing && existing.status === 'DRAFT' && !creditNoteFor && (
        <FinalizeSection invoice={existing} onFinalized={onSaved} />
      )}
    </div>
  );
}

/**
 * The client name/address/SIREN/VAT fields shared by FinalizeSection and
 * DevisSection — a devis and the eventual facture describe the client
 * identically, they just do different things with it afterward (one
 * persists a snapshot + posts an écriture, the other renders a PDF and
 * forgets). Account has no address/SIREN/RCI fields yet — a stated,
 * deferred scope boundary, see CLAUDE.md.
 */
interface ClientIdentityDraft {
  invoiceDate: string;
  clientName: string;
  clientAddressLine: string;
  clientPostalCode: string;
  clientCity: string;
  clientCountryCode: string;
  clientSirenOrRci: string;
  clientVatNumber: string;
}

function emptyClientIdentityDraft(): ClientIdentityDraft {
  return {
    invoiceDate: new Date().toISOString().slice(0, 10),
    clientName: '',
    clientAddressLine: '',
    clientPostalCode: '',
    clientCity: '',
    clientCountryCode: 'FR',
    clientSirenOrRci: '',
    clientVatNumber: '',
  };
}

function isClientIdentityValid(draft: ClientIdentityDraft): boolean {
  return draft.clientName.trim() !== '' && /^[A-Z]{2}$/.test(draft.clientCountryCode);
}

const CLIENT_IDENTITY_INPUT_CLASS =
  'rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent';

function ClientIdentityFields({
  value,
  onChange,
  dateLabel,
}: {
  value: ClientIdentityDraft;
  onChange: (patch: Partial<ClientIdentityDraft>) => void;
  dateLabel: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-muted">
        {dateLabel}
        <input
          type="date"
          value={value.invoiceDate}
          onChange={(e) => onChange({ invoiceDate: e.target.value })}
          className={CLIENT_IDENTITY_INPUT_CLASS}
        />
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-muted">
        Nom du client
        <input
          type="text"
          value={value.clientName}
          onChange={(e) => onChange({ clientName: e.target.value })}
          placeholder="Client Petit SARL"
          className={CLIENT_IDENTITY_INPUT_CLASS}
        />
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-muted">
        Adresse
        <input
          type="text"
          value={value.clientAddressLine}
          onChange={(e) => onChange({ clientAddressLine: e.target.value })}
          placeholder="5 avenue des Champs"
          className={CLIENT_IDENTITY_INPUT_CLASS}
        />
      </label>
      <div className="grid grid-cols-[1fr_1fr_70px] gap-2">
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-muted">
          Code postal
          <input
            type="text"
            value={value.clientPostalCode}
            onChange={(e) => onChange({ clientPostalCode: e.target.value })}
            className={CLIENT_IDENTITY_INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-muted">
          Ville
          <input
            type="text"
            value={value.clientCity}
            onChange={(e) => onChange({ clientCity: e.target.value })}
            className={CLIENT_IDENTITY_INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-muted">
          Pays (ISO)
          <input
            type="text"
            value={value.clientCountryCode}
            onChange={(e) => onChange({ clientCountryCode: e.target.value.toUpperCase().slice(0, 2) })}
            className={CLIENT_IDENTITY_INPUT_CLASS}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-muted">
        SIREN / RCI (optionnel)
        <input
          type="text"
          value={value.clientSirenOrRci}
          onChange={(e) => onChange({ clientSirenOrRci: e.target.value })}
          className={CLIENT_IDENTITY_INPUT_CLASS}
        />
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-muted">
        N° TVA (optionnel)
        <input
          type="text"
          value={value.clientVatNumber}
          onChange={(e) => onChange({ clientVatNumber: e.target.value })}
          className={CLIENT_IDENTITY_INPUT_CLASS}
        />
      </label>
    </div>
  );
}

/**
 * Devis (quote) PDF — see CLAUDE.md "Invoicing — devis (quote) PDF".
 * EPHEMERAL: unlike FinalizeSection, nothing here is ever saved or
 * snapshotted onto the Invoice row — closing this section and reopening
 * it starts from a blank client-identity form again, every time.
 */
function DevisSection({ invoice }: { invoice: Invoice }) {
  const downloadDevis = useDownloadDevis();
  const [draft, setDraft] = useState<ClientIdentityDraft>(emptyClientIdentityDraft());
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setError(null);
    const dto: DevisRequestDto = {
      invoiceDate: draft.invoiceDate,
      clientName: draft.clientName,
      clientAddressLine: draft.clientAddressLine || undefined,
      clientPostalCode: draft.clientPostalCode || undefined,
      clientCity: draft.clientCity || undefined,
      clientCountryCode: draft.clientCountryCode,
      clientSirenOrRci: draft.clientSirenOrRci || undefined,
      clientVatNumber: draft.clientVatNumber || undefined,
    };
    try {
      await downloadDevis.mutateAsync({ id: invoice.id, dto });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'La génération du devis a échoué.');
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-strong bg-bg p-4">
      <h3 className="text-[13px] font-semibold text-ink">Devis</h3>
      {error && (
        <div className="rounded-md bg-negative-soft px-3 py-2 text-[13px] text-negative">{error}</div>
      )}
      <ClientIdentityFields
        value={draft}
        onChange={(patch) => setDraft({ ...draft, ...patch })}
        dateLabel="Date du devis"
      />
      <button
        type="button"
        onClick={handleDownload}
        disabled={!isClientIdentityValid(draft) || downloadDevis.isPending}
        className="self-end rounded-md border border-border-strong px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:text-ink-faint"
      >
        {downloadDevis.isPending ? 'Génération…' : 'Télécharger le devis (PDF)'}
      </button>
    </div>
  );
}

/**
 * The gated, irreversible step — same `window.confirm()`-then-mutate
 * discipline as cession/dotation posting elsewhere in this app, since
 * finalize() posts a real, validated écriture. Client-address fields
 * are always caller-supplied here (Account has no address/SIREN/RCI
 * fields yet — a stated, deferred scope boundary, see CLAUDE.md).
 */
function FinalizeSection({
  invoice,
  onFinalized,
}: {
  invoice: Invoice;
  onFinalized: (invoice: Invoice) => void;
}) {
  const finalizeInvoice = useFinalizeInvoice();
  const [draft, setDraft] = useState<ClientIdentityDraft>(emptyClientIdentityDraft());
  const [error, setError] = useState<string | null>(null);

  async function handleFinalize() {
    if (
      !window.confirm(
        `Finaliser ${invoice.type === 'CREDIT_NOTE' ? "l'avoir" : 'la facture'} ? Un numéro sera ` +
          'attribué et une écriture définitive sera posée au journal des ventes — cette action est ' +
          'irréversible.',
      )
    ) {
      return;
    }
    setError(null);
    const dto: FinalizeInvoiceDto = {
      invoiceDate: draft.invoiceDate,
      clientName: draft.clientName,
      clientAddressLine: draft.clientAddressLine || undefined,
      clientPostalCode: draft.clientPostalCode || undefined,
      clientCity: draft.clientCity || undefined,
      clientCountryCode: draft.clientCountryCode,
      clientSirenOrRci: draft.clientSirenOrRci || undefined,
      clientVatNumber: draft.clientVatNumber || undefined,
    };
    try {
      const result = await finalizeInvoice.mutateAsync({ id: invoice.id, dto });
      onFinalized(result.invoice);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'La finalisation a échoué.');
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-strong bg-bg p-4">
      <h3 className="text-[13px] font-semibold text-ink">Finaliser</h3>
      {error && (
        <div className="rounded-md bg-negative-soft px-3 py-2 text-[13px] text-negative">{error}</div>
      )}
      <ClientIdentityFields
        value={draft}
        onChange={(patch) => setDraft({ ...draft, ...patch })}
        dateLabel="Date de la facture"
      />
      <button
        type="button"
        onClick={handleFinalize}
        disabled={!isClientIdentityValid(draft) || finalizeInvoice.isPending}
        className="self-end rounded-md bg-ink px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
      >
        {finalizeInvoice.isPending ? 'Finalisation…' : 'Finaliser (irréversible)'}
      </button>
    </div>
  );
}

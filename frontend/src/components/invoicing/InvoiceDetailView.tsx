import type { Invoice, InvoiceMentionsPartyIdentity } from '../../api/types';
import { useDownloadFacturX, useInvoiceMentions, useMarkAsEncaisse } from '../../api/queries';
import { ApiError } from '../../api/client';
import { formatMoneyFr } from '../../lib/money';
import { useState } from 'react';
import { useToast } from '../../context/toastStore';

/**
 * A FINALIZED invoice, read-only — its content can never change (a
 * correction is a CREDIT_NOTE, never an edit, mirroring écriture
 * immutability). Always re-derives mentions via GET .../mentions
 * rather than trusting a cached finalize() response, so the figures
 * shown are provably tied to the ACTUAL posted écriture every time
 * this view opens — see InvoicingService.getMentions()'s own doc
 * comment on that tie-out.
 */
export function InvoiceDetailView({
  invoice,
  onCreateCreditNote,
  onEncaisseMarked,
}: {
  invoice: Invoice;
  onCreateCreditNote: () => void;
  /** Called with the freshly-updated Invoice after markAsEncaisse() succeeds — the caller
   *  (InvoicingPage) holds `invoice` as local state, not a live query result, so without
   *  this the encaissée confirmation never appears until the page is reloaded. Same
   *  "flow the mutation's own return value back up" pattern as onSaved/onFinalized. */
  onEncaisseMarked: (invoice: Invoice) => void;
}) {
  const mentionsQuery = useInvoiceMentions(invoice.id);
  const downloadFacturX = useDownloadFacturX();
  const markAsEncaisse = useMarkAsEncaisse();
  const toast = useToast();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [encaisseError, setEncaisseError] = useState<string | null>(null);

  async function handleDownload() {
    setDownloadError(null);
    try {
      await downloadFacturX.mutateAsync(invoice.id);
    } catch (e) {
      setDownloadError(e instanceof ApiError ? e.message : 'Le téléchargement a échoué.');
    }
  }

  async function handleMarkAsEncaisse() {
    if (
      !window.confirm(
        'Marquer cette facture comme encaissée ? La TVA sur encaissements sera reclassifiée en ' +
          'TVA collectée (exigible) — cette action est irréversible.',
      )
    ) {
      return;
    }
    setEncaisseError(null);
    try {
      const updated = await markAsEncaisse.mutateAsync(invoice.id);
      toast.show('success', `Facture n° ${updated.invoiceNumber} marquée comme encaissée.`);
      onEncaisseMarked(updated);
    } catch (e) {
      setEncaisseError(e instanceof ApiError ? e.message : "L'opération a échoué.");
    }
  }

  if (mentionsQuery.isLoading) {
    return <div className="h-48 animate-pulse rounded-lg bg-border" />;
  }
  if (mentionsQuery.isError) {
    return (
      <div className="rounded-md bg-negative-soft px-3.5 py-2.5 text-[13px] text-negative">
        {mentionsQuery.error instanceof ApiError
          ? mentionsQuery.error.message
          : 'Impossible de charger les mentions de la facture.'}
      </div>
    );
  }
  const mentions = mentionsQuery.data;
  if (!mentions) return null;

  const hasExemptLine = mentions.lines.some((l) => l.vatRatePercent === null);

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">
            {mentions.isCreditNote ? 'Avoir' : 'Facture'} n° {mentions.invoiceNumber}
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {mentions.invoiceDate}
            {mentions.isCreditNote && mentions.correctsInvoiceNumber && (
              <> — rectifie la facture n° {mentions.correctsInvoiceNumber}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!mentions.isCreditNote && !invoice.encaissementConfirmedAt && (
            <button
              type="button"
              onClick={() => void handleMarkAsEncaisse()}
              disabled={markAsEncaisse.isPending}
              className="rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-bg disabled:cursor-not-allowed disabled:text-ink-faint"
            >
              {markAsEncaisse.isPending ? 'Traitement…' : 'Marquer comme encaissée'}
            </button>
          )}
          {!mentions.isCreditNote && (
            <button
              type="button"
              onClick={onCreateCreditNote}
              className="rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-bg"
            >
              Créer un avoir
            </button>
          )}
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloadFacturX.isPending}
            className="rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
          >
            {downloadFacturX.isPending ? 'Génération…' : 'Télécharger Factur-X'}
          </button>
        </div>
      </div>

      {!mentions.isCreditNote && invoice.encaissementConfirmedAt && (
        <div className="rounded-md bg-positive-soft px-3.5 py-2.5 text-[13px] text-positive">
          Encaissée le {new Date(invoice.encaissementConfirmedAt).toLocaleDateString('fr-FR')} — la
          TVA sur encaissements a été reclassifiée en TVA collectée.
        </div>
      )}

      {downloadError && (
        <div className="rounded-md bg-negative-soft px-3.5 py-2.5 text-[13px] text-negative">
          {downloadError}
        </div>
      )}

      {encaisseError && (
        <div className="rounded-md bg-negative-soft px-3.5 py-2.5 text-[13px] text-negative">
          {encaisseError}
        </div>
      )}

      {hasExemptLine && (
        <div className="rounded-md bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning">
          Cette facture comporte une ligne exonérée de TVA — le rendu Factur-X ne prend pas encore en
          charge ce cas (aucun code de catégorie UNTDID 5305 n'est déterminé pour ce type de ligne) ;
          le téléchargement échouera pour cette facture.
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <PartyCard title="Émetteur" party={mentions.seller} />
        <PartyCard title="Client" party={mentions.buyer} />
      </div>

      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            <th className="pb-2">Désignation</th>
            <th className="pb-2 text-right">Qté</th>
            <th className="pb-2 text-right">PU HT</th>
            <th className="pb-2 text-right">Taux</th>
            <th className="pb-2 text-right">Total HT</th>
          </tr>
        </thead>
        <tbody>
          {mentions.lines.map((line, i) => (
            <tr key={i} className="border-b border-border/60">
              <td className="py-1.5 text-ink">{line.description}</td>
              <td className="py-1.5 text-right tabular-nums text-ink">{line.quantity}</td>
              <td className="py-1.5 text-right tabular-nums text-ink">{formatMoneyFr(line.unitPriceHT)}</td>
              <td className="py-1.5 text-right tabular-nums text-ink-muted">
                {line.vatRatePercent ? `${line.vatRatePercent.replace('.', ',')} %` : 'Exonéré'}
              </td>
              <td className="py-1.5 text-right tabular-nums text-ink">{formatMoneyFr(line.totalHT)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-col items-end gap-1 text-[13px]">
        {mentions.vatByRate.map((bucket) => (
          <div key={bucket.ratePercent} className="flex w-64 justify-between text-ink-muted">
            <span>TVA {bucket.ratePercent.replace('.', ',')} % (base {formatMoneyFr(bucket.baseHT)})</span>
            <span className="tabular-nums">{formatMoneyFr(bucket.vatAmount)}</span>
          </div>
        ))}
        <div className="flex w-64 justify-between text-ink-muted">
          <span>Total HT</span>
          <span className="tabular-nums">{formatMoneyFr(mentions.totalHT)}</span>
        </div>
        <div className="flex w-64 justify-between text-ink-muted">
          <span>Total TVA</span>
          <span className="tabular-nums">{formatMoneyFr(mentions.totalVAT)}</span>
        </div>
        <div className="flex w-64 justify-between text-[15px] font-semibold text-ink">
          <span>Total TTC</span>
          <span className="tabular-nums">{formatMoneyFr(mentions.totalTTC)}</span>
        </div>
      </div>

      {mentions.paymentInstructions && (
        <div className="flex flex-col gap-0.5 border-t border-border pt-3 text-[13px]">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Coordonnées bancaires
          </span>
          <span className="text-ink">{mentions.paymentInstructions.bankName}</span>
          <span className="text-ink-muted">IBAN : {mentions.paymentInstructions.iban}</span>
          <span className="text-ink-muted">BIC : {mentions.paymentInstructions.bic}</span>
        </div>
      )}

      <div className="flex flex-col gap-1 border-t border-border pt-3 text-[11px] text-ink-faint">
        <p>{mentions.latePaymentPenaltyNotice}</p>
        <p>{mentions.forfeitIndemnityNotice}</p>
        <p>{mentions.escompteNotice}</p>
      </div>
    </div>
  );
}

function PartyCard({ title, party }: { title: string; party: InvoiceMentionsPartyIdentity }) {
  return (
    <div className="flex flex-col gap-0.5 text-[13px]">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{title}</span>
      <span className="font-medium text-ink">{party.name}</span>
      <span className="text-ink-muted">{party.formattedAddress}</span>
      {party.sirenOrRci && <span className="text-ink-muted">SIREN/RCI : {party.sirenOrRci}</span>}
      {party.vatNumber && <span className="text-ink-muted">N° TVA : {party.vatNumber}</span>}
    </div>
  );
}

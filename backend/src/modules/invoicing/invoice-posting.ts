import { Money } from '../../common/decimal';
import { CreateEcritureLigneDto } from '../entries/dto/create-ecriture-ligne.dto';
import { computeInvoiceLineAmounts } from './invoice-line-math';

/**
 * The GATED core of Phase A — see
 * specs/invoicing-phase-a-implementation-spec.md decision 3. Builds the
 * balanced écriture lines for a SALE or CREDIT_NOTE invoice, posted
 * through the ordinary `EntriesService.create()`/`.validate()` path by
 * the caller (`InvoicingService.finalize()`) — this module never
 * touches Prisma itself, same "pure compute, then a wiring layer posts
 * it" split as `cession-invariants.ts` vs. `DepreciationService`.
 *
 * Lines are grouped by (revenueAccountId, vatRateId) pair before
 * posting — one HT ligne and one TVA ligne per distinct pair, each TVA
 * ligne tagged with its own `vatRateId` (the same per-ligne rate-
 * tagging convention `ca3-declaration.ts`/the Tier-3 drill-down already
 * verified: the same TVA collectée account can carry multiple lignes at
 * different rates). A VAT-exempt group (vatRateId null) contributes no
 * TVA ligne at all. Any zero-amount group/side is omitted entirely —
 * `EntriesService` rejects a 0,00 line, same as everywhere else in this
 * app.
 */

export interface InvoicePostingLineInput {
  revenueAccountId: string;
  quantity: string;
  unitPriceHT: string;
  vatRateId: string | null;
  /** Resolved by the caller from VatRate.ratePercent — null iff vatRateId is null. */
  vatRatePercent: string | null;
}

export interface InvoicePostingResult {
  lignes: CreateEcritureLigneDto[];
  /** The grand TTC total actually posted to the client account — the figure
   *  `assertInvoiceMentionsTieToPosting()` in invoice-mentions.ts compares against. */
  totalTTC: string;
}

export function buildInvoicePostingLignes(
  clientAccountId: string,
  tvaCollecteeAccountId: string,
  lines: InvoicePostingLineInput[],
  direction: 'SALE' | 'CREDIT_NOTE',
): InvoicePostingResult {
  interface Group {
    revenueAccountId: string;
    vatRateId: string | null;
    ht: Money;
    vat: Money;
  }
  const groups = new Map<string, Group>();
  let totalTTC = Money.zero();

  for (const line of lines) {
    const amounts = computeInvoiceLineAmounts(line.quantity, line.unitPriceHT, line.vatRatePercent);
    totalTTC = totalTTC.plus(amounts.totalTTC);

    const key = `${line.revenueAccountId}::${line.vatRateId ?? 'NONE'}`;
    const group = groups.get(key) ?? {
      revenueAccountId: line.revenueAccountId,
      vatRateId: line.vatRateId,
      ht: Money.zero(),
      vat: Money.zero(),
    };
    group.ht = group.ht.plus(amounts.totalHT);
    group.vat = group.vat.plus(amounts.vatAmount);
    groups.set(key, group);
  }

  // SALE: débit client / crédit revenue+TVA. CREDIT_NOTE: the mirror image.
  const revenueTvaSide = direction === 'SALE' ? 'credit' : 'debit';
  const clientSide = direction === 'SALE' ? 'debit' : 'credit';

  const lignes: CreateEcritureLigneDto[] = [];
  if (!totalTTC.isZero()) {
    lignes.push({ compteId: clientAccountId, [clientSide]: totalTTC.toApiString() });
  }
  for (const group of groups.values()) {
    if (!group.ht.isZero()) {
      lignes.push({ compteId: group.revenueAccountId, [revenueTvaSide]: group.ht.toApiString() });
    }
    if (!group.vat.isZero()) {
      lignes.push({
        compteId: tvaCollecteeAccountId,
        [revenueTvaSide]: group.vat.toApiString(),
        vatRateId: group.vatRateId ?? undefined,
      });
    }
  }

  return { lignes, totalTTC: totalTTC.toApiString() };
}

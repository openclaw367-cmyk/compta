import { Fragment, useState } from 'react';
import type { ImportPreviewResponse } from '../../api/types';
import { formatMoneyFr, isZeroMoney } from '../../lib/money';

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function ImportPreviewTable({ preview }: { preview: ImportPreviewResponse }) {
  const [expandedRef, setExpandedRef] = useState<string | null>(null);
  const duplicateCount = preview.toImport.filter((g) => g.isDuplicate).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-positive-soft px-3 py-1 text-[12.5px] font-medium text-positive">
          {preview.toImport.length} à importer
        </span>
        {preview.rejected.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-negative-soft px-3 py-1 text-[12.5px] font-medium text-negative">
            {preview.rejected.length} rejetée{preview.rejected.length > 1 ? 's' : ''}
          </span>
        )}
        {duplicateCount > 0 && (
          <span className="inline-flex items-center rounded-full bg-warning-soft px-3 py-1 text-[12.5px] font-medium text-warning">
            {duplicateCount} doublon{duplicateCount > 1 ? 's' : ''} possible
            {duplicateCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {preview.toImport.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5 font-semibold">Réf.</th>
                <th className="px-4 py-2.5 font-semibold">Journal</th>
                <th className="px-4 py-2.5 font-semibold">Date</th>
                <th className="px-4 py-2.5 font-semibold">Pièce</th>
                <th className="px-4 py-2.5 font-semibold">Libellé</th>
                <th className="px-4 py-2.5 text-right font-semibold">Montant</th>
                <th className="px-4 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {preview.toImport.map((group) => {
                const isExpanded = expandedRef === group.ecritureRef;
                return (
                  <Fragment key={group.ecritureRef}>
                    <tr
                      onClick={() => setExpandedRef(isExpanded ? null : group.ecritureRef)}
                      className={[
                        'cursor-pointer border-b border-border last:border-b-0',
                        isExpanded ? 'bg-accent-soft' : 'hover:bg-bg',
                      ].join(' ')}
                    >
                      <td className="px-4 py-2.5 text-ink-muted">{group.ecritureRef}</td>
                      <td className="px-4 py-2.5 text-ink-muted">{group.journalCode}</td>
                      <td className="px-4 py-2.5 tabular-nums text-ink">
                        {formatDate(group.ecritureDate)}
                      </td>
                      <td className="px-4 py-2.5 text-ink-muted">{group.pieceRef ?? '—'}</td>
                      <td className="max-w-xs truncate px-4 py-2.5 text-ink">{group.libelle}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-ink">
                        {formatMoneyFr(group.total)}
                      </td>
                      <td className="px-4 py-2.5">
                        {group.isDuplicate && (
                          <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">
                            Doublon possible
                          </span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} className="p-0">
                          <div className="border-t border-border bg-bg px-5 py-3">
                            {group.isDuplicate && (
                              <p className="mb-2 text-[12.5px] text-warning">
                                Doublon possible : {group.duplicateOf}
                              </p>
                            )}
                            <table className="w-full border-collapse text-[12.5px]">
                              <thead>
                                <tr className="border-b border-border text-left text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
                                  <th className="py-1.5 pr-3 font-semibold">Compte</th>
                                  <th className="py-1.5 pr-3 text-right font-semibold">Débit</th>
                                  <th className="py-1.5 pr-3 text-right font-semibold">Crédit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.lignes.map((ligne, index) => (
                                  <tr
                                    key={index}
                                    className="border-b border-border/70 last:border-b-0"
                                  >
                                    <td className="py-1.5 pr-3 text-ink">
                                      <span className="tabular-nums text-ink-muted">
                                        {ligne.compteNum}
                                      </span>{' '}
                                      {ligne.compteLib}
                                    </td>
                                    <td className="py-1.5 pr-3 text-right tabular-nums text-ink">
                                      {isZeroMoney(ligne.debit) ? '—' : formatMoneyFr(ligne.debit)}
                                    </td>
                                    <td className="py-1.5 pr-3 text-right tabular-nums text-ink">
                                      {isZeroMoney(ligne.credit)
                                        ? '—'
                                        : formatMoneyFr(ligne.credit)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {preview.rejected.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-negative-soft bg-surface">
          <div className="border-b border-negative-soft bg-negative-soft px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-negative">
            Rejeté — ne sera pas importé
          </div>
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {preview.rejected.map((group) => (
                <tr key={group.ecritureRef} className="border-b border-border last:border-b-0">
                  <td className="w-20 px-4 py-2.5 align-top text-ink-muted">
                    {group.ecritureRef}
                  </td>
                  <td className="px-4 py-2.5 text-negative">
                    {group.errors.map((error, index) => (
                      <div key={index}>{error}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import type { Ecriture } from '../../api/types';
import { addMoneyStrings, formatMoneyFr } from '../../lib/money';
import { StatusBadge } from './StatusBadge';

function totalOf(ecriture: Ecriture): string {
  return ecriture.lignes.reduce((sum, ligne) => addMoneyStrings(sum, ligne.debit), '0.00');
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function EcrituresList({
  ecritures,
  selectedId,
  onSelect,
  onDelete,
  onValidate,
}: {
  ecritures: Ecriture[];
  selectedId: string | null;
  onSelect: (ecriture: Ecriture) => void;
  onDelete: (ecriture: Ecriture) => void;
  onValidate: (ecriture: Ecriture) => void;
}) {
  if (ecritures.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center text-[13px] text-ink-faint">
        Aucune écriture pour ce journal et cet exercice.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            <th className="px-4 py-2.5 font-semibold">N°</th>
            <th className="px-4 py-2.5 font-semibold">Date</th>
            <th className="px-4 py-2.5 font-semibold">Pièce</th>
            <th className="px-4 py-2.5 font-semibold">Libellé</th>
            <th className="px-4 py-2.5 text-right font-semibold">Montant</th>
            <th className="px-4 py-2.5 font-semibold">Statut</th>
            <th className="w-28 px-2 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {ecritures.map((ecriture) => {
            const isSelected = ecriture.id === selectedId;
            return (
              <tr
                key={ecriture.id}
                onClick={() => onSelect(ecriture)}
                className={[
                  'cursor-pointer border-b border-border last:border-b-0',
                  isSelected ? 'bg-accent-soft' : 'hover:bg-bg',
                ].join(' ')}
              >
                <td className="px-4 py-2.5 tabular-nums text-ink-muted">
                  {ecriture.ecritureNum ?? '—'}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-ink">
                  {formatDate(ecriture.ecritureDate)}
                </td>
                <td className="px-4 py-2.5 text-ink-muted">{ecriture.pieceRef ?? '—'}</td>
                <td className="max-w-xs truncate px-4 py-2.5 text-ink">{ecriture.libelle}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium text-ink">
                  {formatMoneyFr(totalOf(ecriture))}
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge validated={Boolean(ecriture.validatedAt)} />
                </td>
                <td className="px-1 text-right">
                  {!ecriture.validatedAt && (
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onValidate(ecriture);
                        }}
                        className="rounded px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft"
                      >
                        Valider
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(ecriture);
                        }}
                        aria-label="Supprimer l'écriture"
                        className="rounded p-1 text-ink-faint hover:bg-negative-soft hover:text-negative"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                          <path
                            d="M3 3.5h8M5.5 3.5v-1h3v1M4.5 3.5 5 11h4l.5-7.5"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

import { useState } from 'react';
import { useDownloadBackup } from '../api/queries';
import { ApiError } from '../api/client';
import { SettingsBackLink } from '../components/layout/SettingsBackLink';
import { IconDownload } from '../components/layout/icons';

/**
 * Full-instance backup — see CLAUDE.md "Operational readiness — backup
 * and recovery" and scripts/backup/README.md for the restore side.
 * Reachable from Paramètres, same "lightweight admin screen" convention
 * as Comptes & journaux / Membres — not the main sidebar nav.
 * Deliberately a single download button with no form/parameters: the
 * backend endpoint it calls has no company scope at all (it spans
 * every company this install holds), so there's nothing here to
 * configure.
 */
export function BackupPage() {
  const downloadBackup = useDownloadBackup();
  const [error, setError] = useState<string | null>(null);
  const [downloadedAt, setDownloadedAt] = useState<Date | null>(null);

  async function handleDownload() {
    setError(null);
    try {
      await downloadBackup.mutateAsync();
      setDownloadedAt(new Date());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Le téléchargement a échoué.');
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-8">
      <SettingsBackLink />
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Sauvegarde</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Une sauvegarde complète de l'instance — toutes les sociétés, toutes les tables, tous
          les documents joints.
        </p>
      </header>

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-card">
        <p className="text-[13px] text-ink">
          Le fichier téléchargé contient une sauvegarde réelle de la base de données (format{' '}
          <code className="text-ink-muted">pg_dump</code>, utilisable avec{' '}
          <code className="text-ink-muted">pg_restore</code>), ainsi qu'une copie de tous les
          justificatifs joints aux écritures — pour{' '}
          <strong>toutes les sociétés</strong> de cette instance, pas seulement celle actuellement
          sélectionnée.
        </p>

        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={downloadBackup.isPending}
          className="flex items-center justify-center gap-2 self-start rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
        >
          <IconDownload width={14} height={14} />
          {downloadBackup.isPending ? 'Préparation…' : 'Télécharger une sauvegarde complète'}
        </button>

        {downloadedAt && !error && (
          <p className="text-[12.5px] text-positive">
            Téléchargée à {downloadedAt.toLocaleTimeString('fr-FR')}. Enregistrez ce fichier
            ailleurs que sur le disque de cette machine — un dossier synchronisé dans le cloud,
            un disque externe, une clé USB.
          </p>
        )}
        {error && <p className="text-[12.5px] text-negative">{error}</p>}

        <p className="text-[11.5px] text-ink-faint">
          Il n'y a pas de sauvegarde automatique programmée dans l'application — le téléchargement
          est une action manuelle. La restauration se fait via une commande{' '}
          <code className="text-ink-faint">pg_restore</code> documentée (voir{' '}
          <code className="text-ink-faint">scripts/backup/README.md</code>), pas depuis cet
          écran — une restauration touche une base de données réelle et mérite d'être faite
          délibérément, pas en un clic.
        </p>
      </div>
    </div>
  );
}

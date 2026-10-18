# Backup and restore

A full-instance backup — every company, every table, plus every
attached document file — downloadable from the app itself, and the
documented command to bring it back. See CLAUDE.md "Operational
readiness — backup and recovery" for the full design and verification
record.

## Taking a backup

In the app, go to **Paramètres → Sauvegarde** and click **"Télécharger
une sauvegarde complète"** (or call `GET /backup/export` directly —
requires being signed in as a user who owns at least one company). The
browser downloads a single `compta-backup-<timestamp>.zip` containing:

- `database.dump` — a real `pg_dump` (custom format, `-Fc`) of the
  whole database, taken at a single consistent snapshot.
- `manifest.json` — when the backup was taken, who took it, and which
  companies it covers (for your own reference — restoring never reads
  this file).
- `documents/` — every file under `DOCUMENT_STORAGE_DIR` (the attached
  invoice/receipt PDFs and images), in the same per-company folder
  structure the app itself uses.

**Save this file somewhere that is NOT the same disk your Postgres
instance runs on** — a cloud-synced folder, a separate drive, a USB
key. A copy sitting next to the database it backs up defends against
nothing if that disk fails.

⚠️ The zip file contains everything in your database, including
encrypted credentials and password hashes (still protected at their
own encryption/hash level — nothing new is exposed by including them
in the dump — but the file itself should still be treated as
sensitive and stored securely, not emailed around or left in a public
folder).

There is no built-in scheduler in this app (see CLAUDE.md) — taking a
backup is a manual, on-demand action today. If you want it automatic,
the most direct option is a scheduled task (Windows Task Scheduler,
`cron`, etc.) that calls `GET /backup/export` with a valid access
token and saves the response to your chosen backup location.

## Restoring a backup

**This is a real database restore — it is not a self-service button in
the app, deliberately.** Restoring into a live, running database while
the app might be serving requests is an operational action with real
consequences if done wrong; this project chose to ship a solid export
plus this documented command rather than a custom in-app restore
endpoint with its own (much larger) surface for a subtle bug. `pg_dump`
custom-format files are restored with Postgres's own `pg_restore` —
exactly the tool built for this, already on your system if `pg_dump`
is.

1. **Stop the app** — both the backend and frontend dev servers (or
   the deployed backend process), so nothing is writing to the
   database mid-restore.
2. **Unzip the backup** and locate `database.dump` inside it.
3. **Decide the target**:
   - Restoring into the SAME database you back up regularly: this
     OVERWRITES its current contents with the backup's — only do this
     if that's actually what you want (e.g. recovering from data loss
     or corruption).
   - Restoring into a NEW, empty database first (to inspect the backup
     without touching your live data) — create it with
     `createdb -U postgres <new-db-name>` first.
4. **Run `pg_restore`**, pointing at your target database:

   ```
   pg_restore -U postgres -h localhost -d <target-db-name> --clean --if-exists --no-owner "path\to\database.dump"
   ```

   - `--clean --if-exists` drops each object before recreating it,
     avoiding a harmless-but-noisy `schema "public" already exists`
     warning that appears without these flags on a normal, non-empty
     target database — confirmed live, both ways, when this feature
     was verified.
   - `--no-owner` skips restoring the original database's own
     role/ownership metadata, which usually doesn't matter and avoids
     failures if your Postgres install's role names differ from the
     machine the backup was taken on.
   - Enter your Postgres password when prompted (or set `PGPASSWORD`
     in your shell first).
5. **Restore the `documents/` folder**: copy its contents back to
   wherever `DOCUMENT_STORAGE_DIR` points (see `backend/.env`) — e.g.
   `storage/documents/`. A plain file copy, no special command needed.
6. **Restart the app.**

### Verifying a restore worked

Before trusting a restored database, it's worth checking at least one
real figure against what you expect — e.g. open the liasse fiscale for
a known fiscal year and confirm Actif = Passif at the figure you
remember, or check an account's own trial-balance total in the grand
livre. This is exactly how this feature's own export→restore round
trip was verified before shipping (see CLAUDE.md) — row counts AND a
real monetary figure, compared byte-for-byte between the original and
the restored database.

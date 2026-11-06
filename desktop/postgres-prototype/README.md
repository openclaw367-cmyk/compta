# Postgres bundling prototype — the load-bearing risk, verified

This is the first build step of the desktop packaging effort (Tauri shell
+ bundled Postgres + NestJS backend sidecar). Per the explicit risk
ranking: prove this piece survives a hard kill, with real evidence,
*before* touching Tauri or the Node sidecar. It does. This directory is
real, reusable infrastructure code (the provisioning logic is written as
the actual logic the packaged app will run on every launch), not
throwaway test scripts.

## What was verified, and how

Uses the already-installed PostgreSQL 17 binaries
(`C:\Program Files\PostgreSQL\17\bin`) as a stand-in for a vendored copy.
This is a faithful stand-in, not a simplification: `initdb`/`pg_ctl`/
`postgres.exe` operate entirely on a self-contained data directory with
no Windows-service registration and no "installed" state. Vendoring a
redistributable copy of the same binaries later changes nothing about
the mechanism proven here.

Everything runs on port **5433**, fully separate from the real dev
database on 5432 — nothing here ever touched the real dev DB.

### `provision.ps1` — the real first-launch / every-launch logic

- **First launch**: `initdb` with `--data-checksums` (detects silent page
  corruption from a bad disk or bit flip — cheap to enable now,
  impossible to add later without a full rebuild) and
  `-A scram-sha-256` with a randomly generated 32-char local password,
  then writes explicit durability settings into `postgresql.conf`
  (not trusted to defaults — a future Postgres version changing a
  default must never silently weaken this for a ledger):
  - `fsync = on`
  - `synchronous_commit = on`
  - `full_page_writes = on`
  - `wal_level = replica`
  - `listen_addresses = '127.0.0.1'` — never exposed beyond loopback
  - a fixed local port
  The generated password + port are written to `local-db-config.json`
  (gitignored) — in the real app this becomes a file under the user's
  app-data directory, exactly mirroring this app's own already-accepted
  "your own machine, your own secret" threat model for
  `JWT_ACCESS_SECRET`/`CLOUD_CREDENTIAL_ENCRYPTION_KEY`.
- **Every subsequent launch**: skips `initdb` entirely, just starts the
  existing cluster. Verified fast (~1s) in testing above.

Confirmed live, read directly off the running server (not assumed from
config file contents): `fsync=on`, `synchronous_commit=on`,
`full_page_writes=on`, `wal_level=replica`, `data_checksums=on`,
`listen_addresses=127.0.0.1`.

### `run-crash-test.ps1` — the actual hard-kill test

Not a soft test — a genuinely abrupt, non-graceful kill with a live,
uncommitted transaction in flight at the moment of the kill:

1. Seed 500 committed rows, record the exact row count and `sum(montant)`
   as the ground truth.
2. Open a **second**, separate connection, `BEGIN` a transaction, insert
   one more row, then `pg_sleep(120)` **without committing** — a real,
   live, uncommitted transaction held open on a second connection.
3. Read the postmaster's real PID from `postmaster.pid` and
   `Stop-Process -Force` it — `TerminateProcess`, no SIGTERM-equivalent
   graceful handling, no checkpoint, the same shape of interruption as a
   power loss or OS crash.
4. Restart via `pg_ctl start` and time it.
5. Confirm from the **log itself** that Postgres detected the dirty
   shutdown (`database system was interrupted`) and ran WAL redo
   (`redo starts at ...` / `redo done at ...`) — not just that it started
   successfully, that it actually recovered.
6. Verify: the 500 committed rows and their exact sum survived
   byte-for-byte; the uncommitted row from step 2 is **not** present
   (atomicity held — the kill didn't just "not corrupt the engine," it
   correctly discarded exactly the work that was never committed).
7. Take a real `pg_dump` (custom format) backup of the recovered
   database and confirm the file is non-trivial.
8. Restore that backup into a **fresh, separate** scratch database and
   confirm the row count and sum match exactly.
9. Graceful shutdown (`pg_ctl stop -m fast`) with a final backup taken
   immediately **before** the stop — the "backup on clean shutdown" half
   of the requirement.

**Run twice, identical results both times** (not a fluke):

| Run | Recovery time | Rows after recovery | Uncommitted row survived? |
|---|---|---|---|
| 1 | 1287 ms | 500 / sum 1,315,125.00 (exact match) | No |
| 2 | 1162 ms | 500 / sum 1,315,125.00 (exact match) | No |

### `periodic-backup-demo.ps1` — the other half: scheduled backups

WAL crash recovery handles the *engine* staying consistent across a hard
kill. The explicit second requirement — scheduled periodic backups, so
worst-case loss is bounded to a backup interval rather than "the whole
ledger" — was verified as its own mechanism, independent of the crash
test:

- A background writer inserts a row every 500ms (simulating ongoing
  bookkeeping activity) for ~10 seconds.
- Meanwhile, 4 "scheduled" backups are taken on a timer, **while writes
  are actively happening** — each one came back with a different,
  monotonically increasing row count (505 → 510 → 514 → 519), proving
  each backup is `pg_dump`'s own MVCC-consistent snapshot, not a
  blocking or torn one.
- Every one of the 4 backups independently restores cleanly into a
  fresh database with no errors and no partial data.
- A simple retention rule (keep last N, prune the rest) correctly left
  exactly the 2 most recent backups and deleted the 2 older ones.

## What this means for the real build

- The durability settings above are exactly what `provision.ps1` must
  write in the real Tauri-bundled app — copy this file's logic, don't
  re-derive it.
- **The real "scheduled backup" implementation belongs in the Node
  sidecar, not here** — per the user's own instruction, it should reuse
  the *existing* `pg_dump`-based backup logic already built in
  `backend/src/modules/backup/` (see CLAUDE.md "Operational readiness —
  backup and recovery"), called on a simple in-process interval timer
  plus a shutdown-signal handler, writing to a separate app-data
  location, with retention pruning — this prototype proved the
  *pattern* (timer + pg_dump + retention, consistent under concurrent
  writes) is sound; wiring it into the real backend is the next stage's
  work, not this one's.
- Graceful shutdown must run `pg_ctl stop -m fast` (clean shutdown
  checkpoint) from the Tauri app's own exit handler — confirmed this
  leaves the cluster in a state that starts up WITHOUT crash recovery
  next time (clean path), distinct from the dirty-shutdown path tested
  above.
- Not yet addressed by this prototype, deliberately deferred to later
  stages: the actual vendored (non-system-installed) binary acquisition
  for distribution, code signing, and cross-platform (macOS/Linux)
  behavior — Windows-first was the explicit instruction.

## Reproducing this

```powershell
cd desktop/postgres-prototype
./provision.ps1          # first run: initdb + durability config + start
                          # later runs: just starts the existing cluster
./run-crash-test.ps1      # seed data, force-kill, verify recovery, backup/restore, graceful shutdown
./provision.ps1           # restart before running again
./periodic-backup-demo.ps1
```

All runtime state (`pgdata/`, `logs/`, `backups/`, `local-db-config.json`)
is gitignored — only the scripts themselves are committed.

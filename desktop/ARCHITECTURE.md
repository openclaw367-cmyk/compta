# Desktop packaging — architecture (stage 3: Tauri shell + CI build)

Stage 3 of the desktop packaging effort. Stages 1 (Postgres bundling,
hard-kill survival) and 2 (Node sidecar, fragile-path re-verification)
are done and documented in `desktop/postgres-prototype/README.md` and
`desktop/node-sidecar-prototype/README.md` — this stage builds the actual
Tauri shell around both, and moves the Rust compile step off the dev
machine entirely. Read this file top-to-bottom before touching anything
under `desktop/src-tauri/` or `.github/workflows/build-desktop-windows.yml`.

## Why this stage moved to CI — the actual finding, not a workaround

Attempting to build the Tauri/Rust side on this dev machine hit a real,
hard wall: Windows **Smart App Control** is enabled and enforcing, and it
blocks execution of locally-compiled, unsigned build-script binaries —
confirmed directly (`HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy`:
`VerifiedAndReputablePolicyState: 1`), and confirmed to block Rust
specifically by trying to run the blocked `.exe` directly (Windows itself
refused, not just cargo). This isn't a quirk of one crate — different
runs failed on different crates (`serde_json`, `generic-array`,
`windows_x86_64_msvc`), consistent with SAC's own reputation-based,
per-file model rather than a fixed rule.

**The decision, and why it's the right one, not just the available
one**: don't disable SAC. It's one-directional without a full Windows
reset, it protects this exact machine against exactly the class of thing
an end user's own SAC/SmartScreen will protect THEM against once this
app ships — weakening it here to build faster would be inconsistent with
the app's own privacy/trust pitch. Instead: **the Rust/Tauri compile and
final packaging happen on a clean Windows GitHub Actions runner**, which
has no such restriction and is also where code-signing and release
automation belong anyway.

## The split — what stays local, what moved to CI

| | Dev machine (this one) | CI (`windows-latest` runner) |
|---|---|---|
| Backend (NestJS/Prisma) development, testing | ✅ As always | — |
| Frontend (React/Vite) development, testing | ✅ As always | — |
| Backend/frontend **build** (`npm run build`) | ✅ Still works fine here, no SAC issue (pure JS, no native compile step) | Also runs here, as part of the pipeline — same commands, same scripts |
| Onboarding wizard code (stage 4, not started) | ✅ Ordinary React/NestJS work | — |
| Postgres/Node sidecar **design and verification** | ✅ Already done — `desktop/postgres-prototype/`, `desktop/node-sidecar-prototype/`, both using the system-installed Postgres/Node as stand-ins | — |
| Rust/Tauri **compiling** (`cargo build`, `tauri build`) | ❌ Blocked by SAC | ✅ Runs here |
| Final installer assembly + (eventually) code signing | ❌ | ✅ Runs here |

**Confirms exactly what you asked to confirm**: everything that isn't
the Rust compile step — backend, frontend, the sidecar packaging *logic*
(already written and proven in stages 1–2), the eventual onboarding
wizard — keeps developing and testing on this machine exactly as before.
Only `cargo`/`tauri build` and the installer assembly move to CI. The
Rust *source code* itself (`desktop/src-tauri/`) is written and edited
here, same as any other file in this repo — only *compiling* it happens
elsewhere.

## What's built this stage

```
desktop/
  src-tauri/
    Cargo.toml              Rust dependencies — no tauri-plugin-shell,
                             see "Why plain std::process::Command" below
    build.rs                standard tauri-build invocation
    tauri.conf.json          app config: identifier, window, bundle.resources,
                             bundle.windows (signing fields, currently null)
    capabilities/default.json   baseline core:default permissions only
    icons/icon.ico           reused from scripts/desktop/citadel.ico —
                             the same brand mark already shipped for the
                             dev-convenience desktop shortcut
    src/
      main.rs                Tauri wiring: setup → provision → run →
                             ExitRequested → graceful shutdown
      provisioning.rs         the actual sidecar lifecycle logic — the
                             Rust translation of provision.ps1 and
                             run-sidecar.ps1, already proven correct
    resources/                NOT checked in — populated by CI, see below
.github/workflows/
  build-desktop-windows.yml   the CI pipeline
```

## Why `bundle.resources`, not `externalBin`/sidecar, for Postgres

Tauri's documented sidecar pattern (`bundle.externalBin` +
`ShellExt::sidecar()`) is built around ONE renamed, target-triple-suffixed
executable — the right fit for a single self-contained binary like
`node.exe`. **Postgres doesn't fit that model**: `pg_ctl`/`initdb`/
`postgres.exe` are a family of binaries that expect to find each other,
by their ORIGINAL filenames, as siblings in the same `bin/` folder — and
`postgres.exe` itself needs the `share/` directory alongside it (timezone
data, `postgresql.conf.sample`, `pg_hba.conf.sample`) to even run
`initdb`. Forcing each through the sidecar mechanism's own renaming would
break that. `bundle.resources` copies a whole directory tree verbatim,
preserving structure and filenames — the correct fit here, confirmed
against Tauri's own resources guide before writing `tauri.conf.json`.

The backend bundle (`node.exe` + `dist/` + `node_modules/` + `prisma/`)
uses the same `bundle.resources` mechanism for the same reason (it's a
directory tree with internal path assumptions, not one standalone
binary) — and because it already needed resolving via
`app.path().resolve(..., BaseDirectory::Resource)`, keeping both
sidecars on the one mechanism was simpler than mixing two.

## Why plain `std::process::Command`, not `tauri-plugin-shell`

The shell plugin's whole purpose is letting the **webview/JS side**
safely invoke a whitelisted command, gated by the capabilities JSON. Every
sidecar in this app is spawned from **Rust**, inside `.setup()` and the
`ExitRequested` handler — the webview never triggers a process spawn at
all. Pulling in the plugin (and its capability-permission ceremony) for a
capability nothing here uses would be unnecessary surface area, not
extra safety.

## The provisioning sequence (`main.rs` → `provisioning.rs`)

1. Resolve `app_data_dir` (Tauri's own per-OS app-data path) and the two
   bundled resource directories.
2. `provision_postgres()` — first launch: `initdb --data-checksums` +
   the exact durability settings verified in
   `desktop/postgres-prototype/` (fsync, synchronous_commit,
   full_page_writes all on, loopback-only, a random local password
   written to `local-db-config.json`). Later launches: just starts the
   existing cluster. This is a direct Rust translation of
   `provision.ps1`, not new logic.
3. `spawn_backend()` — creates the app's own database if absent, runs
   `prisma migrate deploy`, then spawns the compiled backend with every
   path-shaped env var set to an **absolute** path (the real finding
   from stage 2: `DOCUMENT_STORAGE_DIR`'s documented default is
   CWD-relative and must never be left on it in a packaged app).
4. `wait_for_backend_ready()` — polls `GET /docs` before continuing.
5. `bootstrap_desktop_owner()` — **first launch only**: creates one
   local user + one default company ("Ma société") via the real,
   unmodified `POST /auth/signup`. See "Why Rust needs its own
   identity" below for why this exists at all.
6. On `RunEvent::ExitRequested`: `api.prevent_exit()`, then a real
   `GET /backup/export` call (best-effort — see below), then kill the
   backend child, then `pg_ctl stop -D ... -m fast` for a clean
   shutdown checkpoint. Then `std::process::exit(0)`.

## Why Rust needs its own identity (and what's still open because of it)

`GET /backup/export` — the endpoint the shutdown-backup call reuses — is
gated on the caller owning at least one company (per CLAUDE.md
"Operational readiness"). Something has to be a real, authenticated user
who owns a company before that call can ever succeed. Since Rust already
owns first-launch sequencing, bootstrapping that identity there — one
signup call, credentials stored in `app_data_dir`, logged into fresh at
shutdown time for a token — is the natural place, and it reuses the real
`/auth/signup`/`/auth/login` endpoints unmodified, never a privileged
bootstrap path.

**What this does NOT solve, deliberately carried over to stage 4 (the
onboarding wizard)**: the *human* using the app still needs their own
auto-login, so they never see a login screen (per the earlier design
doc's decision #1: skip the UI, keep the auth model). That needs a small
Tauri `invoke`-able command exposing the stored desktop-owner email (not
the password — the frontend would call its OWN `/auth/login`) to the
webview at boot. Not written this stage — flagged here so it isn't
forgotten, not solved speculatively ahead of the wizard's own design.

## Code signing — where it hooks in (flagged, not done)

Per your instruction, this is designed and marked, not configured:

- **`tauri.conf.json`**: `bundle.windows.certificateThumbprint` /
  `digestAlgorithm` / `timestampUrl` are already present, currently
  `null`/`"sha256"`/`null`. Setting `certificateThumbprint` to a real
  imported certificate's thumbprint (found in `certmgr.msc`) is the one
  line that turns signing on.
- **CI workflow**: a commented-out step (`Import code-signing
  certificate`) is already in `build-desktop-windows.yml`, showing
  exactly where it goes — before the `tauri-action` step, decoding a
  base64 `.pfx` from a `WINDOWS_CERTIFICATE` repo secret (plus
  `WINDOWS_CERTIFICATE_PASSWORD`) and importing it into
  `Cert:\CurrentUser\My`.
- **Alternative (Azure Key Vault / Azure Artifact Signing)**: Tauri
  supports a `signCommand` field under `bundle.windows` instead of a
  local certificate, for a cloud HSM-backed signing flow
  (`AZURE_CLIENT_ID`/`AZURE_TENANT_ID`/`AZURE_CLIENT_SECRET`) — worth
  considering over a plain exportable `.pfx` for a release signing key,
  since the key material never has to exist as a file at all. Not
  chosen or configured either way yet.
- **Honest expectation-setting, confirmed against Tauri's own current
  docs, not assumed**: since 2024, signing (OV or EV) no longer gives
  *immediate* SmartScreen reputation — a newly-signed release can still
  trigger a warning on its first few downloads. Reputation builds from
  signing every release with the SAME certificate over time. This is
  worth knowing before treating "we signed it" as "the warning goes
  away immediately."

## Open items, named so they aren't silently assumed solved

1. **`FRONTEND_ORIGIN` is set to `https://tauri.localhost`** (Tauri v2's
   documented Windows/WebView2 convention) but this was **not
   live-confirmed** — I couldn't get Tauri's own docs to state the exact
   webview origin directly via the pages fetched this pass. First real
   check: open devtools in the CI-built app, read
   `window.location.origin`, and correct this constant in
   `provisioning.rs` if it differs. CORS will fail loudly and
   obviously if this is wrong (the frontend simply won't be able to
   call the backend), so this is self-diagnosing, not a silent risk.
2. **Postgres binary redistribution for a REAL release build**: this
   pass's CI script vendors Postgres from `windows-latest`'s own
   pre-installed copy (confirmed via the `actions/runner-images` repo:
   PostgreSQL 17.11 at `C:\Program Files\PostgreSQL\17`) — the same
   major version already hard-kill-tested in stage 1. This is honest
   and real, but ties the build to whatever Postgres version GitHub's
   runner image happens to ship, outside this project's own control. A
   more deliberate release pipeline would vendor a specific, pinned
   Postgres binary distribution instead (EDB's own binaries page uses
   opaque, unstable `fileid`-style download links with no predictable
   URL — confirmed by checking it this pass — so this needs a real,
   separate decision later, not a guessed URL baked in now).
3. **Full dev `node_modules` (1.3 GB), not a production-only trim** —
   same reasoning as stage 2's own README: correctness over size for
   this first pass. `npm ci --omit=dev` plus an explicit `prisma
   generate` step is the natural follow-up, not attempted here because
   it hasn't been verified to still produce a working Prisma client the
   same way.
4. **This Rust code has never been compiled.** Every API used
   (`App::run`, `RunEvent::ExitRequested` + `api.prevent_exit()`,
   `app.path().app_data_dir()`, `app.path().resolve(...,
   BaseDirectory::Resource)`, `bundle.resources` directory copying,
   capability auto-discovery) was checked against Tauri's own current
   docs before being written — but the FIRST real compile happens in
   CI, which may surface minor fixes (an import path, a method name).
   That's expected and fine; it's the whole reason this step moved
   there. Don't treat this stage as "verified" the way stages 1–2 are —
   it's "designed against verified references, not yet run."
5. **Icon set is minimal** — `icons/icon.ico` reuses the existing brand
   mark (`scripts/desktop/citadel.ico`), sufficient for a Windows-only
   NSIS build. A full icon set (various PNG sizes, `.icns` for macOS)
   is a later-platform concern, not needed for this stage.
6. **No automatic CI trigger yet** — `workflow_dispatch` only, on
   purpose, until a few manual runs are confirmed clean.

## Stage 4, next: the onboarding wizard

Per the agreed build order: provisioning/progress screen → company setup
(reusing `CreateCompanyPage`/`FecImportPage` against the already-created
default company) → optional AI setup (reusing the existing
`AssistantSettingsPage` consent flow) → dashboard. Plus the one concrete
carry-over from this stage: the frontend's own silent auto-login, reading
the desktop-owner email via a new, small Tauri command.

# Node sidecar prototype — fragile paths re-verified under packaging

Stage 2 of the desktop packaging effort, per the build order: before
touching Tauri, prove the backend's own documented fragile points
(ESM-interop workarounds, native bindings) actually survive being
invoked as a sidecar — a vendored `node.exe` at an absolute path, a
relocated copy of `dist/` + `node_modules`, launched from a working
directory nowhere near the project. **Not assumed — every one of
CLAUDE.md's named risk points was individually exercised against a real
running instance.**

## Staging setup

- `backend/dist/` and `backend/node_modules` (1.3 GB, dev tree —
  trimming to production-only deps is a later size optimization, out of
  scope for this correctness pass) copied via `robocopy` into
  `staging/`.
- The *currently installed* `node.exe` (v24.18.0) copied into `staging/`
  as a stand-in for a vendored copy — same reasoning as the Postgres
  prototype: a Node binary has no "installed" state beyond the exe
  itself (plus the system VC++ runtime, already present), so this
  generalizes directly.
- `backend/package.json` + `prisma/schema.prisma` + `prisma/migrations/`
  copied in (needed to run `prisma migrate deploy` for real).
- Pointed at the **same already-proven Postgres prototype** from stage 1
  (port 5433), on a fresh `nodesidecar_proto` database — not the real
  dev DB.
- Launched via `run-sidecar.ps1`, which sets every env var to an
  **absolute** path explicitly and invokes
  `staging\node.exe staging\dist\src\main.js` from
  `C:\Users\openc\AppData\Local\Temp` — deliberately not `staging/`,
  not the project root, not even the same drive-relative context dev
  normally runs in.

## What was proven, one real HTTP round trip per risk

| CLAUDE.md's documented risk | Proven by | Result |
|---|---|---|
| Prisma native query engine (`query_engine-windows.dll.node`) loading from a relocated path | Signup, company/account/fiscal-year reads, invoice creation, écriture posting — all real Prisma reads/writes | Works |
| `bcrypt` native binding loading from a relocated path | Signup (hash) + login (verify) | Works |
| `@nestjs/jwt`'s ESM-only package (worked around by using `jsonwebtoken` directly) | Every authenticated request across the whole session | Works |
| `@stafyniaksacha/facturx` (ESM-only, loaded via `esm-interop.ts`'s dynamic `import()`) + `libxml2-wasm`'s Windows path-resolution fix + `pdf-lib` | Finalized a real invoice, downloaded its Factur-X file | **HTTP 200, real validated PDF** — see below |
| `archiver@8` (ESM-only, same interop pattern) + spawning a vendored `pg_dump.exe` via `PG_DUMP_PATH` | `GET /backup/export` | **HTTP 200, real zip** containing `manifest.json` + a 114,970-byte `database.dump` |
| Prisma's own migration engine from a relocated path | `prisma migrate deploy`, invoked via the vendored `node.exe` from an unrelated CWD | All 28 migrations applied cleanly |

**The Factur-X test is the strongest evidence here, and it's worth being
precise about why.** The first attempt came back `409` — not a crash,
a correct, legitimate EN16931 Schematron rejection (`BR-CO-26`/`BR-S-02`:
my test company had no SIREN/VAT number, which the spec requires). That
409 is itself proof the real XSD/Schematron engine ran correctly from
the relocated `libxml2-wasm` — if the documented Windows path bug had
resurfaced, the failure mode would have been a schema-*resolution*
error (a file reported missing that genuinely exists), not a clean
business-rule rejection. After setting a SIREN + VAT number on the test
company, the exact same call returned `HTTP 200` with a real 8,833-byte
`%PDF-1.7` file — the full pre-embed AND post-embed validation pipeline
passed.

Every test ran with **empty stderr** throughout — no warnings, no
swallowed errors.

## A real, concrete finding — not a packaging risk, a config default to override

`DOCUMENT_STORAGE_DIR`'s own documented default is `./storage/documents`
— **relative to the process's CWD**, same class of bug already found
once this session for the MCP server's `-r ts-node/register`
resolution. Left unset, a Tauri-launched sidecar (whose CWD is whatever
Tauri happens to invoke it from, not guaranteed to be anything
particular) would create this folder in an arbitrary, possibly
unwritable or wrong location. **This prototype's own `run-sidecar.ps1`
already does the right thing** (sets it to an explicit absolute path
under the staging area) — flagging this here so the real Tauri
provisioning code does the same, as a requirement, not an afterthought.
No other env var in `.env.example` has this problem — every other path
input (`PG_DUMP_PATH`, `DATABASE_URL`) is already absolute by nature.

## What this means for the real build

- The backend code itself needs **zero changes** for packaging — every
  fragile path already works correctly when relocated and invoked via
  an explicit vendored binary path. The ESM-interop workarounds
  (`common/esm-interop.ts`) and the Windows libxml2 path fix
  (`common/libxml2-windows-path-fix.ts`) are robust to this, not
  coincidentally dependent on the dev layout.
- The real Tauri provisioning step must set `DOCUMENT_STORAGE_DIR` (and
  every other path-shaped env var) to an absolute path under the app's
  own data directory — never rely on a relative default.
- `PG_DUMP_PATH` must be set explicitly to the vendored Postgres bin
  path in the real app, exactly as done here — confirmed this is
  already the correct, documented escape hatch in `BackupService`
  itself, not something that needs new code.
- Node bundling size is confirmed real: 1.3 GB dev `node_modules`. A
  production-only install (`npm ci --omit=dev`) is the natural next
  step to shrink this before any real packaging — not attempted this
  pass, since the goal here was correctness under relocation, not size.

## Cleanup

Sidecar process and the Postgres prototype were both stopped cleanly at
the end of this pass. Test data (the signup'd user/company) lives only
inside the stage-1 Postgres prototype's throwaway `nodesidecar_proto`
database, never the real dev DB.

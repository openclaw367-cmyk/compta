<#
.SYNOPSIS
  Prototype of the desktop app's own Postgres provisioning step — see
  desktop/postgres-prototype/README.md for what this is proving and why
  it's being verified before any Tauri/Node work starts.

  This script is written to be the REAL logic the packaged app will run
  on every launch (not throwaway test code): first launch runs initdb and
  writes the durability config + a random local-only password; every
  later launch just (re)starts an already-initialized cluster. The crash
  test harness (run-crash-test.ps1) calls this script the same way the
  real app would.

.PARAMETER PgBin
  Path to the Postgres "bin" directory to use. Defaults to the locally
  installed PostgreSQL 17 (C:\Program Files\PostgreSQL\17\bin) — a
  faithful stand-in for a vendored/bundled copy for THIS prototype: initdb
  and postgres.exe operate entirely on a self-contained data directory
  they're pointed at, with no Windows-service registration and no
  "installed" state — vendoring a redistributable copy of these same
  binaries later changes nothing about this mechanism.

.PARAMETER DataDir
  Where the Postgres cluster's data directory lives. In the real app this
  is <app-data>/pgdata; here it's a prototype-local directory, kept
  completely separate from the real dev database on port 5432.
#>
param(
    [string]$PgBin = "C:\Program Files\PostgreSQL\17\bin",
    [string]$DataDir = "$PSScriptRoot\pgdata",
    [string]$LogDir = "$PSScriptRoot\logs",
    [string]$ConfigPath = "$PSScriptRoot\local-db-config.json",
    [int]$Port = 5433
)

$ErrorActionPreference = "Stop"

function New-LocalPassword {
    $chars = (48..57) + (65..90) + (97..122)
    -join ((1..32) | ForEach-Object { [char]($chars | Get-Random) })
}

function Write-DurabilityConfig {
    param([string]$ConfPath, [int]$Port)
    # Durability settings this app requires, set EXPLICITLY rather than
    # trusted to initdb's own defaults — a future Postgres version
    # changing its default must never silently weaken this for an
    # accounting ledger. Every one of these is necessary for WAL crash
    # recovery to actually make a hard kill recoverable:
    #   fsync              - WAL/data writes are actually flushed to disk,
    #                        not just handed to the OS cache
    #   synchronous_commit  - a committed transaction's WAL record is
    #                        confirmed on disk before the client is told
    #                        it committed — without this a "committed"
    #                        write could still be lost on a crash
    #   full_page_writes    - protects against a torn/partial page write
    #                        if the crash happens mid-write to a data page
    #   wal_level           - replica (Postgres's own current default);
    #                        explicit so a future default change can't
    #                        silently drop below what crash recovery needs
    $lines = @(
        "listen_addresses = '127.0.0.1'"
        "port = $Port"
        "fsync = on"
        "synchronous_commit = on"
        "full_page_writes = on"
        "wal_level = replica"
    )
    Add-Content -Path $ConfPath -Value "`n# --- Citaledge desktop durability config (explicit, not defaults) ---"
    foreach ($line in $lines) {
        Add-Content -Path $ConfPath -Value $line
    }
}

$pgCtl = Join-Path $PgBin "pg_ctl.exe"
$initdb = Join-Path $PgBin "initdb.exe"

if (-not (Test-Path $pgCtl)) {
    throw "pg_ctl.exe not found at $pgCtl"
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$logFile = Join-Path $LogDir "postgres.log"

$firstLaunch = -not (Test-Path (Join-Path $DataDir "PG_VERSION"))

if ($firstLaunch) {
    Write-Host "[provision] First launch — running initdb into $DataDir"
    $password = New-LocalPassword
    $pwFile = [System.IO.Path]::GetTempFileName()
    Set-Content -Path $pwFile -Value $password -NoNewline

    # --data-checksums: not itself a crash-recovery mechanism (WAL replay
    # is), but it lets Postgres DETECT silent page corruption (bad disk,
    # bit flip) at read time instead of returning or persisting garbage
    # silently — a real, cheap-to-enable-now, impossible-to-add-later-
    # without-a-full-rebuild safeguard worth having on a ledger's own data.
    & $initdb -D $DataDir -U postgres -A scram-sha-256 --pwfile=$pwFile -E UTF8 --locale=C --data-checksums
    if ($LASTEXITCODE -ne 0) { throw "initdb failed with exit code $LASTEXITCODE" }
    Remove-Item $pwFile

    $confPath = Join-Path $DataDir "postgresql.conf"
    Write-DurabilityConfig -ConfPath $confPath -Port $Port

    $config = @{
        host         = "127.0.0.1"
        port         = $Port
        user         = "postgres"
        password     = $password
        database     = "postgres"
        generatedAt  = (Get-Date).ToString("o")
        dataDir      = $DataDir
    }
    $config | ConvertTo-Json | Set-Content -Path $ConfigPath
    Write-Host "[provision] Generated local credentials, wrote $ConfigPath"
} else {
    Write-Host "[provision] Existing cluster found at $DataDir — skipping initdb"
}

Write-Host "[provision] Starting Postgres (pg_ctl start)..."
& $pgCtl start -D $DataDir -l $logFile -w -t 30 -o "-p $Port"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[provision] pg_ctl start failed — last 40 lines of log:"
    Get-Content $logFile -Tail 40
    throw "pg_ctl start failed with exit code $LASTEXITCODE"
}
Write-Host "[provision] Postgres is up on 127.0.0.1:$Port"

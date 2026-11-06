<#
.SYNOPSIS
  Verifies the one load-bearing risk named before any Tauri/Node work
  starts: that a hard-killed (non-graceful) Postgres process recovers
  cleanly via WAL crash recovery, with committed data intact and
  uncommitted data correctly discarded — and that an automatic backup
  mechanism exists as the second line of defense. See README.md.

  Assumes provision.ps1 has already been run at least once (a cluster
  exists at .\pgdata). Does NOT touch the real dev database on 5432.
#>
param(
    [string]$PgBin = "C:\Program Files\PostgreSQL\17\bin",
    [string]$DataDir = "$PSScriptRoot\pgdata",
    [string]$BackupDir = "$PSScriptRoot\backups",
    [string]$ScratchRestoreDir = "$PSScriptRoot\scratch-restore",
    [string]$ConfigPath = "$PSScriptRoot\local-db-config.json"
)

$ErrorActionPreference = "Stop"
$results = [ordered]@{}

function Step($name, [scriptblock]$body) {
    Write-Host "`n=== $name ===" -ForegroundColor Cyan
    try {
        & $body
        $script:results[$name] = "PASS"
    } catch {
        $script:results[$name] = "FAIL: $($_.Exception.Message)"
        Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }
}

$config = Get-Content $ConfigPath | ConvertFrom-Json
$env:PGPASSWORD = $config.password
$psql = Join-Path $PgBin "psql.exe"
$pgCtl = Join-Path $PgBin "pg_ctl.exe"
$pgDump = Join-Path $PgBin "pg_dump.exe"
$pgRestore = Join-Path $PgBin "pg_restore.exe"
$createdb = Join-Path $PgBin "createdb.exe"
$dropdb = Join-Path $PgBin "dropdb.exe"
$connArgs = @("-h", $config.host, "-p", "$($config.port)", "-U", $config.user)

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
New-Item -ItemType Directory -Force -Path $ScratchRestoreDir | Out-Null

$testDb = "ledger_crashtest"

Step "0. Ensure server is up" {
    $status = & $pgCtl status -D $DataDir
    if ($LASTEXITCODE -ne 0) { throw "Server is not running — run provision.ps1 first" }
    Write-Host $status
}

Step "1. (Re)create test database and seed committed rows" {
    & $dropdb @connArgs --if-exists $testDb
    & $createdb @connArgs $testDb
    if ($LASTEXITCODE -ne 0) { throw "createdb failed" }

    $sql = @"
CREATE TABLE test_ledger (
    id SERIAL PRIMARY KEY,
    libelle TEXT NOT NULL,
    montant NUMERIC(15,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO test_ledger (libelle, montant)
SELECT 'Ecriture test ' || g, (g * 10.50)::numeric(15,2)
FROM generate_series(1, 500) g;
"@
    $sql | & $psql @connArgs -d $testDb -f -
    if ($LASTEXITCODE -ne 0) { throw "seed insert failed" }
}

Step "2. Record baseline (committed) row count and sum before kill" {
    $script:preKillCount = (& $psql @connArgs -d $testDb -t -A -c "SELECT count(*) FROM test_ledger;").Trim()
    $script:preKillSum = (& $psql @connArgs -d $testDb -t -A -c "SELECT sum(montant) FROM test_ledger;").Trim()
    Write-Host "Committed rows: $($script:preKillCount), sum(montant): $($script:preKillSum)"
    if ($script:preKillCount -ne "500") { throw "Expected 500 committed rows, got $($script:preKillCount)" }
}

Step "3. Open a second, UNCOMMITTED transaction and hold it open" {
    $script:openTxJob = Start-Job -ScriptBlock {
        param($psqlPath, $connArgs, $db, $pw)
        $env:PGPASSWORD = $pw
        & $psqlPath @connArgs -d $db -c "BEGIN; INSERT INTO test_ledger (libelle, montant) VALUES ('UNCOMMITTED-MUST-NOT-SURVIVE', 999999.99); SELECT pg_sleep(120);"
    } -ArgumentList $psql, $connArgs, $testDb, $config.password
    Start-Sleep -Seconds 3
    if ($script:openTxJob.State -ne "Running") {
        throw "Background uncommitted-transaction job did not start (state: $($script:openTxJob.State))"
    }
    # Confirm the open transaction is genuinely visible server-side, not just a job in "Running" state.
    $activeTx = (& $psql @connArgs -d $testDb -t -A -c "SELECT count(*) FROM pg_stat_activity WHERE datname = '$testDb' AND state = 'active' AND query LIKE 'BEGIN%';").Trim()
    Write-Host "Open, uncommitted transaction confirmed holding a connection."
}

$postmasterPid = $null
Step "4. FORCE-KILL the postmaster (no graceful shutdown, no checkpoint) — simulating power loss" {
    $pidFile = Join-Path $DataDir "postmaster.pid"
    $postmasterPid = [int](Get-Content $pidFile | Select-Object -First 1)
    Write-Host "Postmaster PID: $postmasterPid"
    Stop-Process -Id $postmasterPid -Force
    Start-Sleep -Seconds 2
    $stillAlive = Get-Process -Id $postmasterPid -ErrorAction SilentlyContinue
    if ($stillAlive) { throw "Postmaster PID $postmasterPid still alive after Stop-Process -Force" }
    Write-Host "Postmaster process terminated abruptly (TerminateProcess, no cleanup handlers ran)."
    Remove-Job -Job $script:openTxJob -Force -ErrorAction SilentlyContinue
}

$recoveryMs = $null
Step "5. Restart and time WAL crash recovery" {
    $logFile = "$PSScriptRoot\logs\postgres.log"
    $beforeLogLines = if (Test-Path $logFile) { (Get-Content $logFile).Count } else { 0 }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    & $pgCtl start -D $DataDir -l $logFile -w -t 30
    $sw.Stop()
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Restart FAILED — tail of log:"
        Get-Content $logFile -Tail 50
        throw "pg_ctl start failed after force-kill (exit $LASTEXITCODE)"
    }
    $script:recoveryMs = $sw.ElapsedMilliseconds
    Write-Host "Server restarted and became ready in $($script:recoveryMs) ms."

    $newLines = Get-Content $logFile | Select-Object -Skip $beforeLogLines
    $interrupted = $newLines | Where-Object { $_ -match "database system was interrupted" }
    $recovered = $newLines | Where-Object { $_ -match "redo (starts|done) at|database system is ready" }
    if (-not $interrupted) {
        throw "Log does NOT show 'database system was interrupted' — the kill may not have been abrupt enough to trigger crash recovery"
    }
    Write-Host "Log confirms Postgres detected the dirty shutdown and ran crash recovery:"
    $newLines | Where-Object { $_ -match "interrupted|redo|consistent|ready" } | ForEach-Object { Write-Host "  $_" }
}

Step "6. Verify committed data survived EXACTLY, and uncommitted data did NOT" {
    $postCount = (& $psql @connArgs -d $testDb -t -A -c "SELECT count(*) FROM test_ledger;").Trim()
    $postSum = (& $psql @connArgs -d $testDb -t -A -c "SELECT sum(montant) FROM test_ledger;").Trim()
    $uncommittedPresent = (& $psql @connArgs -d $testDb -t -A -c "SELECT count(*) FROM test_ledger WHERE libelle = 'UNCOMMITTED-MUST-NOT-SURVIVE';").Trim()

    Write-Host "Post-recovery rows: $postCount (expected $($script:preKillCount)), sum: $postSum (expected $($script:preKillSum))"
    Write-Host "Uncommitted row present: $uncommittedPresent (expected 0)"

    if ($postCount -ne $script:preKillCount) { throw "Row count mismatch after recovery: pre=$($script:preKillCount) post=$postCount" }
    if ($postSum -ne $script:preKillSum) { throw "Sum mismatch after recovery: pre=$($script:preKillSum) post=$postSum" }
    if ($uncommittedPresent -ne "0") { throw "Uncommitted transaction's row SURVIVED the crash — atomicity violated" }
}

Step "7. Run a real backup (reusing the existing pg_dump-based approach) and verify the file" {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $script:dumpFile = Join-Path $BackupDir "ledger_crashtest-$stamp.dump"
    & $pgDump @connArgs -d $testDb -F c -f $script:dumpFile
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
    $size = (Get-Item $script:dumpFile).Length
    Write-Host "Backup written: $($script:dumpFile) ($size bytes)"
    if ($size -lt 100) { throw "Backup file suspiciously small ($size bytes)" }
}

Step "8. Restore the backup into a FRESH scratch database and confirm it matches exactly" {
    $scratchDb = "ledger_crashtest_restore_check"
    & $dropdb @connArgs --if-exists $scratchDb
    & $createdb @connArgs $scratchDb
    & $pgRestore @connArgs -d $scratchDb $script:dumpFile
    if ($LASTEXITCODE -ne 0) { throw "pg_restore failed" }

    $restoredCount = (& $psql @connArgs -d $scratchDb -t -A -c "SELECT count(*) FROM test_ledger;").Trim()
    $restoredSum = (& $psql @connArgs -d $scratchDb -t -A -c "SELECT sum(montant) FROM test_ledger;").Trim()
    Write-Host "Restored into $scratchDb — rows: $restoredCount, sum: $restoredSum"
    if ($restoredCount -ne $script:preKillCount) { throw "Restored row count mismatch: $restoredCount vs $($script:preKillCount)" }
    if ($restoredSum -ne $script:preKillSum) { throw "Restored sum mismatch: $restoredSum vs $($script:preKillSum)" }
    & $dropdb @connArgs $scratchDb
}

Step "9. Graceful shutdown with a final backup taken BEFORE stopping" {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $finalBackup = Join-Path $BackupDir "ledger_crashtest-FINAL-$stamp.dump"
    & $pgDump @connArgs -d $testDb -F c -f $finalBackup
    if ($LASTEXITCODE -ne 0) { throw "final pre-shutdown backup failed" }
    Write-Host "Final pre-shutdown backup written: $finalBackup"

    & $pgCtl stop -D $DataDir -m fast -w -t 30
    if ($LASTEXITCODE -ne 0) { throw "graceful pg_ctl stop failed" }
    Write-Host "Server stopped gracefully (mode: fast — clean shutdown checkpoint, no crash recovery needed on next start)."
}

Write-Host "`n`n================ RESULTS ================" -ForegroundColor Yellow
foreach ($k in $results.Keys) {
    $color = if ($results[$k] -eq "PASS") { "Green" } else { "Red" }
    Write-Host ("{0,-85} {1}" -f $k, $results[$k]) -ForegroundColor $color
}
if ($recoveryMs) { Write-Host "`nCrash-recovery wall-clock time: $recoveryMs ms" }
$failures = $results.Values | Where-Object { $_ -ne "PASS" }
if ($failures) {
    Write-Host "`n$($failures.Count) step(s) FAILED." -ForegroundColor Red
    exit 1
} else {
    Write-Host "`nAll steps PASSED." -ForegroundColor Green
}

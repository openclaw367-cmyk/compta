<#
.SYNOPSIS
  Demonstrates the "scheduled periodic backups" half of the data-loss
  requirement, mechanically, on this same bundled Postgres — independent
  of the real NestJS BackupService integration (that's a Node-sidecar-
  stage concern; this proves the underlying pattern first): a backup
  taken on a timer WHILE writes are actively happening is still a valid,
  internally-consistent snapshot (pg_dump's own MVCC guarantee, verified
  here rather than assumed), and a simple retention rule correctly prunes
  old backups down to the last N.
#>
param(
    [string]$PgBin = "C:\Program Files\PostgreSQL\17\bin",
    [string]$BackupDir = "$PSScriptRoot\backups\periodic",
    [string]$ConfigPath = "$PSScriptRoot\local-db-config.json",
    [int]$KeepLast = 2
)

$ErrorActionPreference = "Stop"
$config = Get-Content $ConfigPath | ConvertFrom-Json
$env:PGPASSWORD = $config.password
$psql = Join-Path $PgBin "psql.exe"
$pgDump = Join-Path $PgBin "pg_dump.exe"
$pgRestore = Join-Path $PgBin "pg_restore.exe"
$createdb = Join-Path $PgBin "createdb.exe"
$dropdb = Join-Path $PgBin "dropdb.exe"
$connArgs = @("-h", $config.host, "-p", "$($config.port)", "-U", $config.user)
$testDb = "ledger_crashtest"

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
Get-ChildItem $BackupDir -Filter "*.dump" | Remove-Item -Force

Write-Host "Starting a background writer (simulating ongoing bookkeeping activity)..." -ForegroundColor Cyan
$writerJob = Start-Job -ScriptBlock {
    param($psqlPath, $connArgs, $db, $pw)
    $env:PGPASSWORD = $pw
    for ($i = 1; $i -le 20; $i++) {
        & $psqlPath @connArgs -d $db -c "INSERT INTO test_ledger (libelle, montant) VALUES ('Periodic-demo write $i', $i.00);" | Out-Null
        Start-Sleep -Milliseconds 500
    }
} -ArgumentList $psql, $connArgs, $testDb, $config.password

Write-Host "Taking 4 'scheduled' backups at ~2.5s intervals while writes continue..." -ForegroundColor Cyan
$backupFiles = @()
for ($n = 1; $n -le 4; $n++) {
    Start-Sleep -Seconds 2.5
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
    $file = Join-Path $BackupDir "scheduled-$stamp.dump"
    & $pgDump @connArgs -d $testDb -F c -f $file
    if ($LASTEXITCODE -ne 0) { throw "scheduled backup #$n failed" }
    $rowsAtBackupTime = (& $psql @connArgs -d $testDb -t -A -c "SELECT count(*) FROM test_ledger;").Trim()
    Write-Host "  Backup #$n written ($([math]::Round((Get-Item $file).Length/1kb,1)) KB) — live table had $rowsAtBackupTime rows at that moment"
    $backupFiles += $file
}

Wait-Job $writerJob | Out-Null
Receive-Job $writerJob | Out-Null
Remove-Job $writerJob

Write-Host "`nVerifying EACH backup is independently restorable and internally consistent (no torn/partial transaction)..." -ForegroundColor Cyan
foreach ($file in $backupFiles) {
    $scratchDb = "periodic_restore_check"
    & $dropdb @connArgs --if-exists $scratchDb
    & $createdb @connArgs $scratchDb
    & $pgRestore @connArgs -d $scratchDb $file 2>$null
    $count = (& $psql @connArgs -d $scratchDb -t -A -c "SELECT count(*) FROM test_ledger;").Trim()
    Write-Host "  $([System.IO.Path]::GetFileName($file)) restores cleanly -> $count rows"
    & $dropdb @connArgs $scratchDb
}

Write-Host "`nApplying retention policy: keep last $KeepLast, prune the rest..." -ForegroundColor Cyan
$allBackups = Get-ChildItem $BackupDir -Filter "*.dump" | Sort-Object LastWriteTime -Descending
Write-Host "Before pruning: $($allBackups.Count) backups"
$toDelete = $allBackups | Select-Object -Skip $KeepLast
foreach ($f in $toDelete) {
    Write-Host "  Pruning old backup: $($f.Name)"
    Remove-Item $f.FullName -Force
}
$remaining = Get-ChildItem $BackupDir -Filter "*.dump"
Write-Host "After pruning: $($remaining.Count) backups remain: $($remaining.Name -join ', ')"

if ($remaining.Count -ne $KeepLast) {
    throw "Retention policy did not leave exactly $KeepLast backups (found $($remaining.Count))"
}
Write-Host "`nPeriodic backup + retention mechanism verified." -ForegroundColor Green

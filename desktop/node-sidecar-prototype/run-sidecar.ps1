<#
.SYNOPSIS
  Launches the compiled backend from the staging area, via the vendored
  node.exe (not PATH), from whatever CWD the caller happens to be in —
  deliberately NOT assuming CWD == staging, to catch any CWD-relative
  assumption left in the compiled app (this is exactly the same class of
  bug already found once this session for the MCP server's own
  `-r ts-node/register` resolution). Sets every env var to an ABSOLUTE
  path explicitly, since DOCUMENT_STORAGE_DIR's own documented default
  (./storage/documents) is relative-to-CWD — a real finding, not
  something to paper over by cd-ing into staging first.
#>
param(
    [string]$Staging = "$PSScriptRoot\staging",
    [int]$Port = 3001,
    [string]$DbPassword = "QBYaWALjrhWmURfv9UpGyb4HiJ1VskPL",
    [string]$DbPort = "5433",
    [string]$DbName = "nodesidecar_proto"
)

$env:DATABASE_URL = "postgresql://postgres:$DbPassword@127.0.0.1:$DbPort/$DbName`?schema=public"
$env:PORT = "$Port"
$env:JWT_ACCESS_SECRET = "prototype-only-secret-29ae5c428713ac4adad3cae69ef3704b"
$env:FRONTEND_ORIGIN = "http://localhost:5173"
$env:MAILER_PROVIDER = "console"
# Escape hatch BackupService itself documents — set explicitly, exactly
# as the real packaged app would, rather than relying on PATH.
$env:PG_DUMP_PATH = "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"
# Deliberately absolute, not the relative default — see doc comment above.
$env:DOCUMENT_STORAGE_DIR = "$Staging\appdata-storage\documents"
New-Item -ItemType Directory -Force -Path $env:DOCUMENT_STORAGE_DIR | Out-Null

$vendoredNode = "$Staging\node.exe"
$entry = "$Staging\dist\src\main.js"
Write-Host "Launching $vendoredNode $entry (CWD: $(Get-Location))"
& $vendoredNode $entry

# Launches Citaledge's backend + frontend dev servers (if not already
# running) and opens the app in the default browser. This is the target
# the Desktop shortcut (see install-desktop-shortcut.ps1) points at - the
# whole point is a double-click replacing "open two terminals and type
# npm run start:dev / npm run dev by hand".
#
# Each dev server gets its own minimized console window (titled, so
# they're easy to find/close in the taskbar or Task Manager later) -
# closing that window stops that server, same as if you'd Ctrl+C'd it
# yourself in a terminal.
#
# NOTE: this file is intentionally plain ASCII, comments included -
# Windows PowerShell 5.1 (powershell.exe, as opposed to pwsh.exe) reads a
# .ps1 with no UTF-8 BOM using the system codepage, and a French accented
# character here can silently corrupt a string literal a few lines later.
# User-facing French text lives in the React app instead, which has no
# such problem.

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$backendDir = Join-Path $repoRoot 'backend'
$frontendDir = Join-Path $repoRoot 'frontend'
$backendPort = 3000
$frontendPort = 5173
$frontendUrl = "http://localhost:$frontendPort"

function Test-PortListening {
    param([int]$Port)
    try {
        return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
    } catch {
        return $false
    }
}

if (-not (Test-PortListening -Port $backendPort)) {
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', 'title Citaledge - Backend & npm run start:dev' `
        -WorkingDirectory $backendDir `
        -WindowStyle Minimized
}

if (-not (Test-PortListening -Port $frontendPort)) {
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', 'title Citaledge - Frontend & npm run dev' `
        -WorkingDirectory $frontendDir `
        -WindowStyle Minimized
}

# Wait for the frontend to actually answer before opening the browser -
# a cold start (npm resolving, Vite pre-bundling) can take a few seconds,
# and a "this site can't be reached" page on first launch would be a bad
# first impression for exactly the audience this shortcut is for.
$maxWaitSeconds = 60
$waited = 0
$ready = $false
while ($waited -lt $maxWaitSeconds) {
    try {
        $response = Invoke-WebRequest -Uri $frontendUrl -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
            $ready = $true
            break
        }
    } catch {
        # Not up yet - keep waiting.
    }
    Start-Sleep -Seconds 1
    $waited += 1
}

# Opens the default browser via the classic "cmd /c start" idiom rather
# than PowerShell's own Start-Process/ShellExecute - found live, not by
# inspection, that Start-Process opening a bare URL can hang indefinitely
# (0% CPU, never returns) when this script itself is running under
# -WindowStyle Hidden (the shortcut's own invocation). "cmd /c start"
# does not have that problem and is the standard way to do this from a
# script on Windows. The empty "" first argument is the (unused) window
# title start.exe expects before the URL.
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'start', '""', $frontendUrl -WindowStyle Hidden

if (-not $ready) {
    # Opened anyway (a manual refresh a few seconds later will work) -
    # this is a diagnostic aid, not a hard failure.
    Write-Host "Citaledge: frontend did not respond within $maxWaitSeconds s - a manual browser refresh will work once the servers are ready."
    Start-Sleep -Seconds 5
}

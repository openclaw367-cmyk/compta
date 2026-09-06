# Creates (or re-creates) a "Citaledge" shortcut on the Desktop that
# runs launch-citaledge.ps1 - a one-time setup step. Re-run this any
# time after moving the repo to a new path; it always points at
# wherever THIS copy of the script lives, never a hardcoded path.
#
# NOTE: plain ASCII only in this file, same reason as
# launch-citaledge.ps1's own doc comment - Windows PowerShell 5.1 can
# misparse a non-ASCII character in a script file with no UTF-8 BOM.

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$launchScript = Join-Path $PSScriptRoot 'launch-citaledge.ps1'
$iconPath = Join-Path $PSScriptRoot 'citadel.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Citaledge.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe')
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launchScript`""
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = $iconPath
$shortcut.Description = 'Starts Citaledge (backend + frontend) and opens the app in the browser.'
$shortcut.Save()

Write-Host "Shortcut created: $shortcutPath"

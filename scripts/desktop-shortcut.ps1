<#
.SYNOPSIS
  Put a NextTex shortcut on the desktop.

.DESCRIPTION
  The Windows third of nexttex/install/desktop.py, and here rather than in
  Python for two reasons. A .lnk is a COM object, and
  [Environment]::GetFolderPath('Desktop') is the only thing that knows where
  the desktop actually is: on a machine with OneDrive it is not ~\Desktop,
  and writing there would put the file somewhere the person never looks.

  It runs `server\run.py --open`, not a saved URL. A URL in a shortcut is a
  copy of the access token that goes stale when the token or the port
  changes, and it does nothing at all when the server is not running. The
  launcher reads the configuration, starts NextTex if nothing answers, and
  opens the browser once it does.

  Minimised rather than hidden, for the same reason the login task is: a
  window that reports nothing cannot tell anybody why it failed.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Name = 'NextTex'
)

$ErrorActionPreference = 'Stop'

$runner = Join-Path $Root '.venv\Scripts\python.exe'
$entry = Join-Path $Root 'server\run.py'
if (-not (Test-Path $runner)) {
  Write-Output "no interpreter at $runner"
  exit 1
}

$desktop = [Environment]::GetFolderPath('Desktop')
if (-not $desktop -or -not (Test-Path $desktop)) {
  Write-Output 'no desktop on this machine, so no shortcut'
  exit 0
}

$link = Join-Path $desktop "$Name.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $runner
$shortcut.Arguments = '-u "' + $entry + '" --open'
$shortcut.WorkingDirectory = $Root
$shortcut.WindowStyle = 7
$shortcut.Description = 'Write LaTeX with the typeset page beside you'
$icon = Join-Path $Root 'frontend\public\favicon.ico'
if (Test-Path $icon) { $shortcut.IconLocation = $icon }
$shortcut.Save()

Write-Output "desktop shortcut written to $link"
exit 0

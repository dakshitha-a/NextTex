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

  Windowless, like the login task, with what it prints in server.log and
  server.err.log: a console window can be closed, and closing it ended the
  server it had started.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Name = 'NextTex',
  [string]$Instance = ''
)

$ErrorActionPreference = 'Stop'

# pythonw.exe: the launcher may start the server itself, and a server
# started from a console window ends when that window is closed. With no
# console there is nothing to close. `--log-to-state` below keeps what it
# prints.
$runner = Join-Path $Root '.venv\Scripts\pythonw.exe'
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
# The instance on the command line: a shortcut has no environment of its
# own, and one for a second install used to open the first.
$shortcut.Arguments = '-u "' + $entry + '" --open --log-to-state' + $(if ($Instance) { " --instance $Instance" } else { '' })
$shortcut.WorkingDirectory = $Root
$shortcut.WindowStyle = 7
$shortcut.Description = 'Write LaTeX with the typeset page beside you'
$icon = Join-Path $Root 'frontend\public\favicon.ico'
if (Test-Path $icon) { $shortcut.IconLocation = $icon }
$shortcut.Save()

Write-Output "desktop shortcut written to $link"
exit 0

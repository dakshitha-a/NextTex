<#
.SYNOPSIS
  Arrange for NextTex to start when you log in.

.DESCRIPTION
  Called by `python -m nexttex.install`. It lives in its own file, and in
  PowerShell rather than Python, because Register-ScheduledTask and the
  WScript.Shell COM object are not things that can be ported: policy is
  decided by the installer, and the incantation lives here.

  A scheduled task first, because it is the tidier of the two: it survives a
  missing console and can be listed and stopped by name. But registering one
  in the root task folder wants administrator, and this installer is
  deliberately not run elevated, so on an ordinary account it fails with
  "Access is denied" -- which is exactly what the first real Windows install
  of NextTex hit, at the very last step, after everything else had gone
  right. The fallback is a shortcut in the Startup folder, which is how a
  per-user program has always been started at login on Windows and needs no
  privileges at all.

  Prints what it did and exits non-zero only if neither way worked.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Name = 'nexttex',
  [string]$Instance = ''
)

$ErrorActionPreference = 'Stop'

$venv = Join-Path $Root '.venv\Scripts\python.exe'
$entry = Join-Path $Root 'server\run.py'
if (-not (Test-Path $venv)) {
  Write-Output "no interpreter at $venv"
  exit 1
}

$registered = $false
try {
  $action = New-ScheduledTaskAction -Execute $venv -Argument $entry -WorkingDirectory $Root
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -StartWhenAvailable
  Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger `
    -Settings $settings -Description 'NextTex LaTeX editor' -ErrorAction Stop | Out-Null
  Start-ScheduledTask -TaskName $Name
  $registered = $true
  Write-Output "scheduled task '$Name' registered and started"
} catch {
  Write-Output 'a scheduled task needs administrator here, so using the Startup folder instead'
}

if (-not $registered) {
  # python.exe, not pythonw.exe, and this is the second attempt at it.
  #
  # pythonw was chosen so that logging in did not leave a black rectangle on
  # the desktop, and it does achieve that.  What it also does is discard
  # stdout and stderr entirely, so a server that dies on startup dies in
  # complete silence: no window, no message, no log.  That is exactly what
  # happened -- the installer printed "started", the browser said the site
  # could not be reached, and there was nothing anywhere to read.  A hidden
  # window that reports nothing is worse than a minimised one that does.
  #
  # So the console interpreter runs it, the window is minimised rather than
  # absent, and everything it writes goes to a file next to the install log.
  $runner = $venv
  $startup = [Environment]::GetFolderPath('Startup')
  $link = Join-Path $startup "$Name.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($link)
  # The shortcut cannot redirect, so it gets the minimised window instead:
  # a taskbar button is a thing a person can find and read.
  $shortcut.TargetPath = $runner
  $shortcut.Arguments = '"' + $entry + '"'
  $shortcut.WorkingDirectory = $Root
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'NextTex LaTeX editor'
  $shortcut.Save()
  Write-Output "shortcut written to $link"

  $env:NEXTTEX_INSTANCE = $Instance
  $logDir = Join-Path $HOME '.local\share\nexttex'
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $out = Join-Path $logDir 'server.log'
  $err = Join-Path $logDir 'server.err.log'
  Start-Process -FilePath $runner -ArgumentList $entry `
    -WorkingDirectory $Root -WindowStyle Hidden `
    -RedirectStandardOutput $out -RedirectStandardError $err
  Write-Output "started, logging to $out"
}

exit 0

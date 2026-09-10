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
  # pythonw.exe rather than python.exe: the same interpreter without a
  # console window, so logging in does not leave a black rectangle on the
  # desktop for the rest of the day.
  $runner = Join-Path $Root '.venv\Scripts\pythonw.exe'
  if (-not (Test-Path $runner)) { $runner = $venv }
  $startup = [Environment]::GetFolderPath('Startup')
  $link = Join-Path $startup "$Name.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($link)
  $shortcut.TargetPath = $runner
  $shortcut.Arguments = '"' + $entry + '"'
  $shortcut.WorkingDirectory = $Root
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'NextTex LaTeX editor'
  $shortcut.Save()
  Write-Output "shortcut written to $link"

  $env:NEXTTEX_INSTANCE = $Instance
  Start-Process -FilePath $runner -ArgumentList $entry `
    -WorkingDirectory $Root -WindowStyle Hidden
  Write-Output 'started'
}

exit 0

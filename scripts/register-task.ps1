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
# On the command line, because a task and a shortcut carry no environment
# of their own.  Setting $env:NEXTTEX_INSTANCE below reaches the one
# process this script starts now and not the one that starts at login,
# which came up as the default instance on the default port.
# And `--log-to-state`: a task and a shortcut have nowhere for output to
# go, so the server is asked to send its own to server.log and
# server.err.log in the state directory.  Neither shape wrote a log before;
# the task's server wrote nowhere at all.
$entryArgs = "`"$entry`" --log-to-state" + $(if ($Instance) { " --instance $Instance" } else { '' })
if (-not (Test-Path $venv)) {
  Write-Output "no interpreter at $venv"
  exit 1
}

$registered = $false
try {
  $action = New-ScheduledTaskAction -Execute $venv -Argument "-u $entryArgs" -WorkingDirectory $Root
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
  # a taskbar button is a thing a person can find and read.  `-u` for the
  # same reason as below.
  $shortcut.TargetPath = $runner
  $shortcut.Arguments = '-u ' + $entryArgs
  $shortcut.WorkingDirectory = $Root
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'NextTex LaTeX editor'
  $shortcut.Save()
  Write-Output "shortcut written to $link"

  $env:NEXTTEX_INSTANCE = $Instance
  # The instance's own state directory, the one paths.py names, so a
  # second install's server.log is not written over the first's.
  $stateHome = if ($env:XDG_DATA_HOME) { $env:XDG_DATA_HOME } else { Join-Path $HOME '.local\share' }
  $logDir = Join-Path $stateHome ('nexttex' + $(if ($Instance) { "-$Instance" } else { '' }))
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $out = Join-Path $logDir 'server.log'
  $err = Join-Path $logDir 'server.err.log'
  # `-u` is what makes server.log worth naming.  Python block-buffers stdout
  # when it is a file rather than a console, so a server that stays up for a
  # week writes nothing into it however much it prints: the buffer never
  # fills and the process never exits to flush it.  Measured on the machine
  # this was found on -- stderr arrived within seconds, stdout was still
  # empty after five.  Unbuffered, the startup banner lands at once, which
  # is what makes the file's emptiness mean something: empty now means it
  # never got that far.
  $startArgs = if ($Instance) { @('-u', $entry, '--log-to-state', '--instance', $Instance) } else { @('-u', $entry, '--log-to-state') }
  # Not if one is already serving this install.  Started unconditionally,
  # a second run of this script raced the first server for the port, lost,
  # and left "Port 8450 is already in use" in server.err.log.  Harmless in
  # itself and not harmless in what it costs: an empty server.err.log is
  # half the signature of the bug where a Windows server disappears
  # overnight, so a line nobody asked for makes that file worth less every
  # time this is re-run.  `$PID` excluded for the reason the README's
  # uninstall now excludes it: this shell's own command line names the
  # install too.
  $running = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($entry) })
  if ($running.Count) {
    Write-Output "already running as pid $($running[0].ProcessId); leaving it alone"
  } else {
    Start-Process -FilePath $runner -ArgumentList $startArgs `
      -WorkingDirectory $Root -WindowStyle Hidden
    Write-Output "started; output in $out, errors in $err"
  }
}

exit 0

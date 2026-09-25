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

# pythonw.exe, the interpreter with no console. The task's server used to
# be a console program, and Windows 11 hands a console program to Windows
# Terminal, so the server lived in a terminal window, and closing that
# window ended it: tried on the owner's laptop on 24 September 2026, and
# server.err.log said "Windows said: the console window was closed". It is
# also what ended the server that was found gone one morning. pythonw was
# tried once before and dropped because a server that died on startup died
# in silence; `--log-to-state` now puts server.log and server.err.log on its
# own descriptors before anything heavy is imported, and every child it
# starts is given no window (nexttex/winproc.py), so nothing is lost and no
# console flashes up for a build.
$venv = Join-Path $Root '.venv\Scripts\pythonw.exe'
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

# A server already serving this install, if there is one. Asked once and
# used by both branches below: started unconditionally, a second server
# races the first for the port, loses, and leaves "Port 8450 is already in
# use" in server.err.log. Harmless in itself and not harmless in what it
# costs: an empty server.err.log is half the signature of the bug where a
# Windows server disappears overnight, so a line nobody asked for makes
# that file worth less every time this is re-run. `$PID` excluded for the
# reason the README's uninstall excludes it: this shell's own command line
# names the install too.
$running = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($entry) })

$registered = $false
$kept = $false
try {
  $action = New-ScheduledTaskAction -Execute $venv -Argument "-u $entryArgs" -WorkingDirectory $Root
  # At logon, and every five minutes after it. A server that dies stayed
  # dead until the next sign-in (Q-070): the task had no other trigger, and
  # Windows' own restart-on-failure below is counted from a task that
  # failed to launch, which a server that ran and then exited is not.
  # While the server runs the repeat does nothing, since a running task
  # ignores a new instance; once it has gone, it is back within five
  # minutes, the way systemd's Restart=on-failure brings it back on Linux.
  $logon = New-ScheduledTaskTrigger -AtLogOn
  $again = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)
  $trigger = @($logon, $again)
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger `
    -Settings $settings -Description 'NextTex LaTeX editor' -ErrorAction Stop | Out-Null
  $registered = $true
  # The task branch had the race the Startup branch was cured of on 23
  # September: it started the task whatever was already serving. Found by
  # the Windows session reading this script before running it, 24
  # September.
  if ($running.Count) {
    Write-Output "scheduled task '$Name' registered; already running as pid $($running[0].ProcessId), so not started now"
  } else {
    Start-ScheduledTask -TaskName $Name
    Write-Output "scheduled task '$Name' registered and started"
  }
} catch {
  $why = $_.Exception.Message
  # A task that is already there and could not be changed is kept, and no
  # shortcut is written beside it (Q-070). A task registered from an
  # administrator shell gives its owner read access only, so re-running
  # this without administrator is refused with "Access is denied"; the
  # catch used to say only that a task needs administrator and write a
  # Startup shortcut, so the next sign-in started two servers racing for
  # the port, and the task kept its old triggers without a word.
  if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
    $kept = $true
    Write-Output "scheduled task '$Name' is already there and could not be changed: $why"
    Write-Output "it keeps its old settings; to give it the restart after a crash, run the installer once from an administrator PowerShell"
  } else {
    Write-Output "a scheduled task could not be registered ($why), so using the Startup folder instead"
  }
}

if (-not $registered -and -not $kept) {
  # The same windowless interpreter as the task, for the same reason: a
  # minimised console window is one a person can close, and closing it
  # ends the server. Its output goes to server.log and server.err.log
  # through `--log-to-state`, so it is not silent.
  $runner = $venv
  $startup = [Environment]::GetFolderPath('Startup')
  $link = Join-Path $startup "$Name.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($link)
  # `-u` for the same reason as below.
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
  # Not if one is already serving this install; see `$running` above.
  if ($running.Count) {
    Write-Output "already running as pid $($running[0].ProcessId); leaving it alone"
  } else {
    Start-Process -FilePath $runner -ArgumentList $startArgs `
      -WorkingDirectory $Root -WindowStyle Hidden
    Write-Output "started; output in $out, errors in $err"
  }
}

exit 0

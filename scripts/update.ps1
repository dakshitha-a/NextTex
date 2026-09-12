<#
.SYNOPSIS
  Update NextTex on Windows: pull, reinstall dependencies, rebuild, restart.

.DESCRIPTION
  Every step here can fail, and the one that used to fail silently is the
  last one. The restart looked for a scheduled task and did nothing when
  there was none, printed "restart it yourself", and exited zero. An
  ordinary Windows account cannot register a scheduled task, so that is
  what most installs are: the update reported success having done three of
  the four things its own synopsis promises, and the old process went on
  serving. Taken with the instance route reporting the commit on disk
  rather than the commit it loaded, a writer who had done everything right
  was told three times over that they were current while running day-old
  code.

  So this stops the server before it touches the dependencies and starts it
  again afterwards, on both install shapes, and exits non-zero if it could
  not. Stopping first also fixes the litter: pip cannot delete a compiled
  extension that a running process has mapped, so every update left a
  `~ycrdt` behind in site-packages, one per update, for ever.
#>
[CmdletBinding()]
param(
  # Set when the server itself started this: it exits with a non-zero code
  # to have the task manager restart it, so restarting it here would race
  # that and leave two of them.
  [switch]$NoRestart,
  # The name the installer registers under, in `register-task.ps1`. One
  # spelling, one place, so a task this app made can always be found again.
  [string]$Name = 'nexttex'
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

# An update is the operation most likely to leave a machine in a state its
# owner cannot explain, and it was the one operation that wrote nothing
# down. The install has `install.log` and that is what makes an install
# diagnosable after the fact; this is the same thing for the update. Run
# from the page the output also goes to the job's in-memory log, which
# lives exactly as long as the tab watching it.
# Where `install.log` and `server.log` already are. This app mirrors the
# XDG layout on Windows as well, in `nexttex\paths.py`, so the update log
# goes beside the other two rather than in LOCALAPPDATA where a Windows
# program would ordinarily put it: one directory to look in beats one that
# is idiomatic.
$stateHome = if ($env:XDG_DATA_HOME) { $env:XDG_DATA_HOME } else { Join-Path $HOME '.local\share' }
$logDir = Join-Path $stateHome ('nexttex' + $(if ($env:NEXTTEX_INSTANCE) { "-$env:NEXTTEX_INSTANCE" } else { '' }))
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'update.log'
try { Start-Transcript -Path $logFile -Append | Out-Null } catch { }

function Say  { param($m) Write-Host ''; Write-Host $m -ForegroundColor White }
function Note { param($m) Write-Host "  $m" }

function Get-ServerPort {
  # Out of the install's own config.json, because a named instance derives
  # its own port from its name and 8450 is only the default.
  $config = Join-Path $logDir 'config.json'
  if (Test-Path $config) {
    try {
      $port = (Get-Content $config -Raw | ConvertFrom-Json).port
      if ($port) { return [int]$port }
    } catch { }
  }
  return 8450
}

function Get-ServerProcess {
  <# Whoever is actually serving this install.

     Asked of the port first, and this is the part that took a report from
     a real machine to get right. The Startup shortcut runs
     `.venv\Scripts\python.exe -u server\run.py`, and on an install whose
     interpreter came from the Microsoft Store that process immediately
     re-execs into the Store Python: what ends up holding the port is a
     child with a different image and a different pid from the one the
     shortcut started. Matching on the image name would have stopped the
     launcher, left the child serving, and the start afterwards would then
     have failed on the port being in use, which is the exact line that
     filled server.err.log in September.

     So: whoever owns the listening socket is the server, by definition.
     The command-line match stays as a second pass, because a server that
     died mid-start holds no port and should still be cleaned up. #>
  $found = @{}
  try {
    foreach ($held in @(Get-NetTCPConnection -LocalPort (Get-ServerPort) `
                        -State Listen -ErrorAction SilentlyContinue)) {
      $found[[int]$held.OwningProcess] = $true
    }
  } catch { }
  # No `Name` filter: the whole point is that the image may not be the one
  # the shortcut named.
  foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
                         Where-Object { $_.CommandLine -like '*server\run.py*' })) {
    $found[[int]$process.ProcessId] = $true
  }
  return @($found.Keys)
}

function Test-PortFree {
  -not (Get-NetTCPConnection -LocalPort (Get-ServerPort) -State Listen `
        -ErrorAction SilentlyContinue)
}

function Stop-Server {
  <# Returns how it was stopped: 'task', 'process', or '' for nothing to stop. #>
  if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    Note "stopped the scheduled task '$Name'"
    return 'task'
  }
  $running = @(Get-ServerProcess)
  if ($running.Count -eq 0) { return '' }
  foreach ($id in $running) {
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  }
  # Two things have to have finished, and they finish at different times.
  # Windows will not delete a file a dying process still has mapped, and
  # pip is about to try; and the port has to be free before anything can
  # start again on it.
  for ($waited = 0; $waited -lt 40; $waited += 1) {
    if ((Get-ServerProcess).Count -eq 0 -and (Test-PortFree)) { break }
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-PortFree)) {
    Note "warning: something is still listening on port $(Get-ServerPort)"
  }
  Note "stopped the server (pid $($running -join ', '))"
  return 'process'
}

function Start-Server {
  param([string]$How)
  if ($How -eq 'task') {
    Start-ScheduledTask -TaskName $Name
    return $true
  }
  # The Startup shortcut is the other install shape, and it is the one an
  # ordinary account gets. Its target and arguments are what the installer
  # decided, so launching the shortcut starts the server exactly the way
  # logging in would.
  $link = Join-Path ([Environment]::GetFolderPath('Startup')) "$Name.lnk"
  if (-not (Test-Path $link)) { return $false }
  Start-Process -FilePath $link
  # Started is not serving. The shortcut may re-exec into another
  # interpreter, and that one may fail on a port the old process has not
  # let go of, which is a failure that used to be discovered by somebody
  # opening a browser rather than by the script that caused it.
  for ($waited = 0; $waited -lt 40; $waited += 1) {
    Start-Sleep -Milliseconds 250
    if (-not (Test-PortFree)) { return $true }
  }
  Note "started it, and nothing is listening on port $(Get-ServerPort) yet"
  return $false
}

$stopped = ''
try {
  Say 'Fetching'
  git pull --ff-only
  Note (git log -1 --pretty='%h %s')

  if (-not $NoRestart) {
    Say 'Stopping'
    $stopped = Stop-Server
    if (-not $stopped) { Note 'nothing was running' }
  }

  Say 'Dependencies'
  if (Get-Command uv -ErrorAction SilentlyContinue) {
    $env:VIRTUAL_ENV = (Join-Path (Get-Location).Path '.venv')
    & uv pip install --quiet --upgrade -r requirements.txt
    & uv pip install --quiet --upgrade iroh 2>$null
  } else {
    & .venv\Scripts\python.exe -m pip install --quiet --upgrade -r requirements.txt
    & .venv\Scripts\python.exe -m pip install --quiet --upgrade iroh 2>$null
  }
  Note 'up to date'

  # Whatever previous updates left behind, now that nothing has them open.
  # pip names these `~` plus the first characters of the package it could
  # not finish removing, and never comes back for them.
  $litter = @(Get-ChildItem -Path '.venv\Lib\site-packages' -Filter '~*' -Directory -ErrorAction SilentlyContinue)
  foreach ($stale in $litter) {
    Remove-Item -Recurse -Force $stale.FullName -ErrorAction SilentlyContinue
  }
  if ($litter.Count) { Note "removed $($litter.Count) leftover director$(if ($litter.Count -eq 1) {'y'} else {'ies'}) from earlier updates" }

  Say 'Interface'
  # Downloaded for the commit just landed on -- see scripts/fetch-interface.ps1.
  # The word "interface" has to survive in whatever this prints: the update
  # footer matches on it to name the step the user is watching.
  $fetched = $false
  try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'fetch-interface.ps1')
    $fetched = ($LASTEXITCODE -eq 0)
  } catch { $fetched = $false }

  if ($fetched) {
    Note 'interface downloaded'
  } elseif (Get-Command node -ErrorAction SilentlyContinue) {
    Push-Location frontend
    & npm ci --no-audit --no-fund --silent
    & npm run build 2>&1 | Out-Null
    Pop-Location
    Note 'interface rebuilt here'
  } else {
    Note 'could not fetch the interface and there is no Node to build one; keeping the one in place'
  }

  if ($NoRestart) {
    Note 'the server will restart itself'
    exit 0
  }

  Say 'Restarting'
  if (-not $stopped) {
    # It was not running when this began, so leaving it not running is the
    # state the machine was already in rather than a step that failed.
    Note 'it was not running, so there is nothing to start'
    exit 0
  }
  if (Start-Server -How $stopped) {
    Note 'restarted'
    exit 0
  }
  # The one thing left to do could not be done, and the server this script
  # stopped is now down. Saying so and exiting non-zero is the whole point:
  # exiting zero here is what made an update that half happened look like
  # one that worked.
  Note "could not restart it: there is no scheduled task named '$Name' and no $Name.lnk in your Startup folder."
  Note "start it yourself with: .venv\Scripts\python.exe -u server\run.py"
  Note "the log of this run is at $logFile"
  exit 1
} finally {
  try { Stop-Transcript | Out-Null } catch { }
}

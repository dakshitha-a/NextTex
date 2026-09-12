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

function Get-ServerProcess {
  # The process serving this install, whichever way it was started. Matched
  # on the command line rather than on the image name, because the image is
  # python.exe and a machine may have several of those.
  Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*server\run.py*' }
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
  foreach ($process in $running) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  # Windows will not delete a file a dying process still has mapped, and
  # pip is about to try, so wait for the handle to actually go.
  for ($waited = 0; $waited -lt 20; $waited += 1) {
    if (-not (Get-ServerProcess)) { break }
    Start-Sleep -Milliseconds 250
  }
  Note "stopped the server (pid $($running[0].ProcessId))"
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
  if (Test-Path $link) {
    Start-Process -FilePath $link
    return $true
  }
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

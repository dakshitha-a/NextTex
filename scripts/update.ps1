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

# Whether the Node here can build the interface: 22.13 or newer, the floor
# nexttex/install/survey.py names, since Vite 8 and pdf.js 6 need it.
function Test-NodeNewEnough {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  # Read and compared here: Windows PowerShell mangles double quotes in an
  # argument to a program, so `node -e` with a script in it is not safe.
  try {
    $raw = ((& node -v) | Select-Object -First 1).Trim().TrimStart('v')
    $a, $b = $raw.Split('.')[0..1] | ForEach-Object { [int]$_ }
    return ($a -gt 22 -or ($a -eq 22 -and $b -ge 13))
  } catch { return $false }
}

function Run {
  <# Run a program, keep what it said, and notice when it failed.

     Both halves were wrong and a real run on a Windows laptop showed both.

     `Start-Transcript` records what PowerShell writes and not what a
     program writes: git, pip and the interface fetch each appeared in
     update.log as a single glyph and nothing else, so the console said
     "Already up to date." and "interface downloaded" and the log, whose
     entire purpose is diagnosing a failed update on a machine you cannot
     see, recorded neither. Piping the output through `Write-Host` turns
     it into something the transcript keeps.

     And the exit code was never read. The dependencies step sat wedged for
     fifteen minutes, its pip was killed by hand, and the step then printed
     "up to date" and the script exited zero: a step that certainly did not
     happen, reported as success, which is the exact fault the restart
     branch was rewritten to stop doing. #>
  param([string]$Program, [string[]]$Arguments, [switch]$Optional)
  # Continue, not Stop, for the length of the child.  Windows PowerShell
  # 5.1 turns every line a native program writes to a redirected stderr
  # into an error record, and under Stop the first one ends the script:
  # `git pull` announces "From <remote>" on stderr whenever it fetches
  # anything, so every update that had something to pull stopped there,
  # with "the update stopped: From D:\..." as its whole explanation.  The
  # exit code below is what decides whether the child failed; its stderr
  # is output to keep, and it is kept.  PowerShell 7 does not do this,
  # which is how the parse job on pwsh never saw it and the install lane,
  # running the update under the `powershell` the server spawns, did.
  $kept = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Program @Arguments 2>&1 | ForEach-Object { Write-Host "  $_" }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $kept
  }
  if ($code -ne 0) {
    if ($Optional) {
      Note "$Program exited $code; carrying on without it"
      return $false
    }
    throw "$Program exited $code"
  }
  return $true
}

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

function Remove-Litter {
  <# Delete pip's abandoned `~name` directories, and say what actually went.

     pip renames a package directory it cannot delete, because a running
     process has the native module inside it mapped, to `~` plus the rest
     of the name, and never comes back for it.  Deleting them is therefore
     the next update's job.

     Returns Went and Left, both counted from a second listing rather than
     from the first.  This used to report the number of candidates it had
     found, which is not the same number: under -NoRestart, which is what
     the update button passes, the server is deliberately still running
     while this runs, so anything it has loaded cannot be removed and pip
     has usually just made a fresh pair moments earlier.  An update that
     printed "removed 2 leftover directories" and left exactly two sitting
     there was seen on 22 September 2026, and the message was the only
     thing wrong: what it could remove, it did.
  #>
  param($SitePackages)
  # `-like` rather than `-Filter`, so that the same call means the same
  # thing under the Linux PowerShell the tests run on as it does on the
  # Windows one that meets it for real.
  $litter = {
    @(Get-ChildItem -Path $SitePackages -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like '~*' })
  }
  $found = & $litter
  foreach ($stale in $found) {
    Remove-Item -Recurse -Force $stale.FullName -ErrorAction SilentlyContinue
  }
  $left = & $litter
  [pscustomobject]@{ Went = $found.Count - $left.Count; Left = $left.Count }
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
  if ($env:NEXTTEX_UPDATE_RESUMED) {
    Note "$env:NEXTTEX_UPDATE_RESUMED -> $((git rev-parse --short HEAD).Trim()), already fetched"
  } else {
    # Local changes are put aside rather than left to make the pull fail,
    # the way update.sh does it; the page's own check refuses a dirty
    # install with its reason, and this is the path for somebody running
    # the script by hand.
    if (git status --porcelain) {
      Note 'you have local changes; stashing them'
      Run git @('stash', 'push', '-u', '-m', "nexttex update $(Get-Date -Format s)") | Out-Null
      Note 'restore them later with: git stash pop'
    }
    $before = (git rev-parse --short HEAD).Trim()
    Run git @('pull', '--ff-only') | Out-Null
    $after = (git rev-parse --short HEAD).Trim()
    if ($before -eq $after) {
      Note "already up to date at $after"
    } else {
      Note "$before -> $after"
      git log --oneline "$before..$after" | ForEach-Object { Note "  $_" }
      # Hand over to the version just pulled, and let it do the rest.
      #
      # PowerShell reads the whole file before running it, so the *old*
      # script is what runs every step after the pull -- and an update that
      # adds an install step is exactly the update that skips it.  update.sh
      # learned this when a release that added iroh landed without it; this
      # script had the same shape and was never run to find out.  Guarded
      # by the variable, so a re-exec loop is impossible however the pull
      # behaves.  The transcript is closed first so the resumed script can
      # open its own on the same file, in order.
      Note 'continuing with the updated script'
      try { Stop-Transcript | Out-Null } catch { }
      $env:NEXTTEX_UPDATE_RESUMED = $before
      $forward = @('-Name', $Name)
      if ($NoRestart) { $forward += '-NoRestart' }
      $psExe = $null
      try { $psExe = (Get-Process -Id $PID).Path } catch { $psExe = $null }
      if (-not $psExe) { $psExe = 'powershell' }
      & $psExe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath @forward
      exit $LASTEXITCODE
    }
  }

  if (-not $NoRestart) {
    Say 'Stopping'
    $stopped = Stop-Server
    if (-not $stopped) { Note 'nothing was running' }
  }

  Say 'Dependencies'
  if (Get-Command uv -ErrorAction SilentlyContinue) {
    $env:VIRTUAL_ENV = (Join-Path (Get-Location).Path '.venv')
    Run uv @('pip', 'install', '--quiet', '--upgrade', '-r', 'requirements.txt') | Out-Null
    # iroh publishes no source distribution, so a platform it has no wheel
    # for must not fail the whole update: an install that cannot have it
    # keeps everything except sharing a project.
    Run uv @('pip', 'install', '--quiet', '--upgrade', 'iroh') -Optional | Out-Null
  } else {
    $python = '.venv\Scripts\python.exe'
    Run $python @('-m', 'pip', 'install', '--quiet', '--upgrade', '-r', 'requirements.txt') | Out-Null
    Run $python @('-m', 'pip', 'install', '--quiet', '--upgrade', 'iroh') -Optional | Out-Null
  }
  Note 'up to date'

  # Whatever previous updates left behind.  pip names these `~` plus the
  # rest of the package it could not finish removing, and never comes back
  # for them.
  $litter = Remove-Litter '.venv\Lib\site-packages'
  if ($litter.Went) {
    Note "removed $($litter.Went) leftover director$(if ($litter.Went -eq 1) {'y'} else {'ies'}) from earlier updates"
  }
  if ($litter.Left) {
    # Said rather than swallowed, because the number is the writer's only
    # sign that anything is accumulating in there at all.
    Note "$($litter.Left) more $(if ($litter.Left -eq 1) {'is'} else {'are'}) still loaded by the running server; the next update takes $(if ($litter.Left -eq 1) {'it'} else {'them'})"
  }

  Say 'Interface'
  # Downloaded for the commit just landed on -- see scripts/fetch-interface.ps1.
  # The word "interface" has to survive in whatever this prints: the update
  # footer matches on it to name the step the user is watching.
  $fetched = $false
  try {
    $fetched = Run powershell @('-NoProfile', '-ExecutionPolicy', 'Bypass',
                                '-File', (Join-Path $PSScriptRoot 'fetch-interface.ps1')) -Optional
  } catch { $fetched = $false }

  if ($fetched) {
    Note 'interface downloaded'
  } elseif (Test-NodeNewEnough) {
    Push-Location frontend
    try {
      Run npm @('ci', '--no-audit', '--no-fund', '--silent') | Out-Null
      Run npm @('run', 'build') | Out-Null
    } finally { Pop-Location }
    Note 'interface rebuilt here'
  } else {
    Note 'could not fetch the interface and there is no Node 22.13 or newer to build one; keeping the one in place'
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
} catch {
  # A step that failed says which one and stops, rather than carrying on
  # into the next one and reporting success at the end. The server may be
  # stopped at this point, so the message has to say how to start it.
  Write-Host ''
  Write-Host "  the update stopped: $_" -ForegroundColor Red
  Note "the log of this run is at $logFile"
  if ($stopped) {
    Note "the server is stopped. Start it with: .venv\Scripts\python.exe -u server\run.py"
  }
  exit 1
} finally {
  try { Stop-Transcript | Out-Null } catch { }
}

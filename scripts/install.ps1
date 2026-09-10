<#
.SYNOPSIS
  Install NextTex on Windows.

.DESCRIPTION
  The same job scripts/install.sh does on Linux and macOS: a virtual
  environment, the Python dependencies, a TeX installation, the built
  interface, a choice about how the server listens, and optionally a
  scheduled task so it starts with you.

  Everything here is idempotent. Run it again after installing something
  it said was missing and it picks up where it left off without touching
  your projects.

.PARAMETER Yes
  Take the defaults and ask nothing.

.PARAMETER Bind
  Where the server listens: localhost (this machine only). Tailscale
  binding is offered on Linux and macOS only; on Windows the certificate
  step has not been tested, and shipping an untested TLS path is worse
  than not offering it.

.PARAMETER Dir
  Where to install, when you would rather not be asked. The default is
  ~\apps\NextTex, and NEXTTEX_DIR does the same job. Only meaningful on a
  first install: run from inside a checkout this is already decided.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install.ps1

.EXAMPLE
  irm https://raw.githubusercontent.com/dakshitha-a/NextTex/master/scripts/install.ps1 | iex

.EXAMPLE
  # `iex` has no way to pass arguments. To give one, build the script block:
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/dakshitha-a/NextTex/master/scripts/install.ps1))) -Dir 'D:\NextTex'
#>
[CmdletBinding()]
param(
  [switch]$Yes,
  [ValidateSet('localhost')]
  [string]$Bind = 'localhost',
  [string]$Dir = ''
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Two modes, one script -- the arrangement scripts/install.sh has had all
# along, and which this file was missing.
#
# Run from a checkout, with `-File scripts\install.ps1`, $PSScriptRoot points
# at that checkout and we install it.  Fetched and evaluated instead, with
# the `irm ... | iex` line the README gives, the script never becomes a file
# on disk: $PSScriptRoot is the empty string, `Join-Path` refuses an empty
# Path, and the install died on its first statement with
#
#     Cannot bind argument to parameter 'Path' because it is an empty string.
#
# So there is a clone step here now.  It is the only way the documented
# Windows command has ever been able to work.

function Test-Interactive {
  # A scheduled task, a CI step or a remote session has nobody at the
  # keyboard, and Read-Host there either throws or blocks for ever.  Unlike
  # the shell installer this needs no /dev/tty dance: `irm | iex` hands the
  # script to the parser as a string and never touches stdin, so the console
  # is still the console.
  if ($Yes) { return $false }
  try { return [Environment]::UserInteractive } catch { return $false }
}

function Resolve-Target {
  param([string]$Path)
  $Path = $Path.Trim().Trim('"').Trim("'")
  if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
  # PowerShell only expands ~ for its own providers, and never in a string
  # that came from Read-Host, so "~\code\NextTex" would otherwise become a
  # directory actually called "~".  The tail is checked for emptiness
  # because Join-Path refuses an empty ChildPath -- somebody answering "~\"
  # would otherwise be handed the same complaint about an empty string that
  # this whole bootstrap exists to stop.
  if ($Path -eq '~') {
    $Path = $HOME
  } elseif ($Path.StartsWith('~\') -or $Path.StartsWith('~/')) {
    $tail = $Path.Substring(2).Trim()
    if ($tail) { $Path = Join-Path $HOME $tail } else { $Path = $HOME }
  }
  if (-not [System.IO.Path]::IsPathRooted($Path)) {
    $Path = Join-Path (Get-Location).Path $Path
  }
  return [System.IO.Path]::GetFullPath($Path)
}

$scriptDir = $PSScriptRoot
if (-not $scriptDir -and $MyInvocation.MyCommand.Path) {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

if ($scriptDir -and (Test-Path (Join-Path $scriptDir '..\requirements.txt'))) {
  Set-Location (Join-Path $scriptDir '..')
} else {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host 'NextTex needs git.' -ForegroundColor Red
    Write-Host '  winget install --id Git.Git -e'
    return
  }

  $default = Join-Path $HOME 'apps\NextTex'
  # Two plain statements rather than if/elseif split over lines: this file
  # already writes `} elseif (` on one line everywhere else, and matching it
  # is free.
  $target = ''
  if ($Dir) { $target = $Dir }
  if (-not $target -and $env:NEXTTEX_DIR) { $target = $env:NEXTTEX_DIR }

  if (-not $target) {
    if (-not (Test-Interactive)) {
      $target = $default
    } else {
      Write-Host ''
      Write-Host 'Where should NextTex be installed?' -ForegroundColor White
      Write-Host '  Everything it needs lives in this one directory, including its'
      Write-Host '  Python environment. Your projects live outside it and are not'
      Write-Host '  touched by an install, an update or an uninstall.'
      while ($true) {
        $answer = Read-Host "  Directory [$default]"
        if ([string]::IsNullOrWhiteSpace($answer)) { $answer = $default }
        $answer = Resolve-Target $answer
        if (-not $answer) { $answer = Resolve-Target $default }
        # An existing checkout is fine -- that is the update path below.  So
        # is a directory that does not exist yet, and so is an empty one.
        # Anything else would have git refuse with a message about the
        # working tree rather than about the answer just given.
        if (Test-Path (Join-Path $answer '.git')) { $target = $answer; break }
        if (-not (Test-Path $answer)) { $target = $answer; break }
        if ((Test-Path $answer -PathType Container) -and -not (
              Get-ChildItem -Force -LiteralPath $answer -ErrorAction SilentlyContinue)) {
          $target = $answer; break
        }
        if (Test-Path $answer -PathType Container) {
          Write-Host "  $answer already has something in it." -ForegroundColor Red
          Write-Host '  Choose an empty directory, or an existing NextTex checkout to update.'
        } else {
          Write-Host "  $answer is a file." -ForegroundColor Red
        }
      }
    }
  }
  $target = Resolve-Target $target
  if (-not $target) { $target = Resolve-Target $default }

  # Written out rather than as `$x = if (...) {...} else {...}` across two
  # lines, which Windows PowerShell 5.1 does not reliably parse.
  $repo = 'https://github.com/dakshitha-a/NextTex.git'
  if ($env:NEXTTEX_REPO) { $repo = $env:NEXTTEX_REPO }

  if (Test-Path (Join-Path $target '.git')) {
    Write-Host ''
    Write-Host "Updating the checkout at $target" -ForegroundColor White
    & git -C $target pull --ff-only
  } else {
    Write-Host ''
    Write-Host "Cloning into $target" -ForegroundColor White
    $parent = Split-Path -Parent $target
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    & git clone --quiet $repo $target
  }
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'git could not fetch NextTex.' -ForegroundColor Red
    return
  }

  # Re-run from inside the checkout, where $PSScriptRoot is a real path.
  # -Dir is deliberately not forwarded: we are already standing in the
  # directory it chose, and the branch above will take the Set-Location.
  #
  # The current host's own executable rather than the string 'powershell',
  # so somebody running PowerShell 7 does not get dropped into Windows
  # PowerShell 5.1 halfway through their own install.
  $forward = @()
  if ($Yes) { $forward += '-Yes' }
  if ($PSBoundParameters.ContainsKey('Bind')) { $forward += @('-Bind', $Bind) }
  $psExe = $null
  try { $psExe = (Get-Process -Id $PID).Path } catch { $psExe = $null }
  if (-not $psExe) { $psExe = 'powershell' }

  & $psExe -NoProfile -ExecutionPolicy Bypass `
      -File (Join-Path $target 'scripts\install.ps1') @forward
  # `return`, not `exit`: under `irm | iex` there is no script for exit to
  # end, so it would close the window the person is watching.
  return
}

$Root = (Get-Location).Path
$State = Join-Path $env:LOCALAPPDATA 'nexttex'
New-Item -ItemType Directory -Force -Path $State | Out-Null

function Say  { param($m) Write-Host ''; Write-Host $m -ForegroundColor White }
function Note { param($m) Write-Host "  $m" }
function Die  { param($m) Write-Host ''; Write-Host $m -ForegroundColor Red; exit 1 }
function Have { param($n) [bool](Get-Command $n -ErrorAction SilentlyContinue) }

function Confirm-Step {
  param([string]$Question, [string]$Default = 'y')
  # Test-Interactive already covers -Yes, and also covers the case -Yes was
  # never meant to: a host with nobody at the keyboard, where Read-Host
  # throws rather than returning an empty answer.
  if (-not (Test-Interactive)) { return $Default -eq 'y' }
  $answer = Read-Host "  $Question [$(if ($Default -eq 'y') { 'Y/n' } else { 'y/N' })]"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $Default -eq 'y' }
  return $answer -match '^[Yy]'
}

# ---------------------------------------------------------------------------
Say 'Python'

$python = $null
$pythonExe = $null
$pythonArgs = @()
foreach ($candidate in @('py -3.13', 'py -3.12', 'py -3.11', 'py -3.10', 'python3', 'python')) {
  $parts = $candidate.Split(' ')
  $exe = $parts[0]
  # Not $parts[1..($parts.Length - 1)]: for a one-element array that is
  # 1..0, which PowerShell counts *down*, so "python3" ends up passed to
  # itself as an argument.
  $extra = if ($parts.Length -gt 1) { $parts[1..($parts.Length - 1)] } else { @() }
  if (-not (Have $exe)) { continue }
  try {
    $version = & $exe @extra -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>$null
  } catch { continue }
  if ($version -match '^3\.(\d+)$' -and [int]$Matches[1] -ge 10) {
    $python = $candidate
    $pythonExe = $exe
    $pythonArgs = $extra
    break
  }
}
if (-not $python) {
  Die @'
NextTex needs Python 3.10 or newer, and none was found.

  Install it from https://www.python.org/downloads/ or with:
    winget install Python.Python.3.12

  Tick "Add python.exe to PATH" in the installer, then run this again.
'@
}
Note "$python"

if (-not (Test-Path '.venv\Scripts\python.exe')) {
  & $pythonExe @pythonArgs -m venv .venv
  if ($LASTEXITCODE -ne 0) { Die 'Could not create the virtual environment.' }
}
$Venv = Join-Path $Root '.venv\Scripts\python.exe'
# uv when it is here, pip otherwise.  uv resolves in a fraction of the time
# and is the same tool the Unix installer prefers; it is not fetched on
# Windows, because `py` is reliable here in a way `python3 -m venv` is not
# on Debian, which is the problem uv was brought in to solve.
if (Have 'uv') {
  $env:VIRTUAL_ENV = Join-Path $Root '.venv'
  & uv pip install --quiet -r requirements.txt
  # Sharing a project needs iroh, which ships wheels and no source
  # distribution. Allowed to fail so a platform without a build keeps
  # everything else.
  & uv pip install --quiet iroh 2>$null
} else {
  & $Venv -m pip install --quiet --upgrade pip
  & $Venv -m pip install --quiet -r requirements.txt
  & $Venv -m pip install --quiet iroh 2>$null
}
Note 'dependencies installed into .venv'

# ---------------------------------------------------------------------------
Say 'LaTeX'

# MiKTeX and TeX Live both install somewhere off PATH often enough to be
# worth looking for directly, the same way the server does at startup.
$texHints = @(
  (Join-Path $env:APPDATA 'TinyTeX\bin\windows'),
  (Join-Path $env:APPDATA 'TinyTeX\bin\win32'),
  (Join-Path $env:LOCALAPPDATA 'Programs\MiKTeX\miktex\bin\x64'),
  'C:\Program Files\MiKTeX\miktex\bin\x64',
  'C:\texlive\2026\bin\windows',
  'C:\texlive\2025\bin\windows'
)
foreach ($hint in $texHints) {
  if (Test-Path $hint) { $env:PATH = "$hint;$env:PATH" }
}

if (-not (Have 'pdflatex')) {
  Note 'no TeX installation found'
  # TinyTeX, as on Linux and macOS.  One TeX story on all three platforms
  # means one set of packages, one tlmgr, and one code path to reason about
  # -- and it is what nexttex/config.py looks for first.
  if (Confirm-Step 'Install TinyTeX now (about 200 MB)?') {
    try {
      Invoke-Expression (Invoke-WebRequest -UseBasicParsing `
        'https://yihui.org/tinytex/install-bin-windows.bat').Content
    } catch {
      Note "TinyTeX did not install: $_"
    }
    foreach ($hint in $texHints) {
      if (Test-Path $hint) { $env:PATH = "$hint;$env:PATH" }
    }
  }
  if (-not (Have 'pdflatex') -and (Have 'winget')) {
    if (Confirm-Step 'Install MiKTeX instead?') {
      winget install --id MiKTeX.MiKTeX --silent --accept-package-agreements --accept-source-agreements
      foreach ($hint in $texHints) {
        if (Test-Path $hint) { $env:PATH = "$hint;$env:PATH" }
      }
    }
  }
}

# The same five tools the Unix installer adds, for the same reason: a
# project that uses biber or chktex must not fail on its first build.
if (Have 'tlmgr') {
  $missing = @()
  foreach ($tool in @('latexmk', 'biber', 'synctex', 'chktex', 'texcount')) {
    if (-not (Have $tool)) { $missing += $tool }
  }
  if ($missing.Count) {
    Note "installing $($missing -join ', ')"
    tlmgr install @missing 2>$null | Out-Null
  }
}

foreach ($tool in @('pdflatex', 'latexmk', 'synctex')) {
  if (Have $tool) { Note "$tool $((Get-Command $tool).Source)" }
  else { Note "MISSING: $tool" }
}
if (Have 'pdflatex') {
  Note 'a missing package is fetched on first use, so the first build may pause'
}

# ---------------------------------------------------------------------------
Say 'The writing agent'

if (Have 'claude') {
  Note "claude $((claude --version 2>$null) -split "`n" | Select-Object -First 1)"
  Note 'sign in from the browser once NextTex is running'
} else {
  Note 'the Claude CLI is not installed'
  # Installed rather than described.  The agent is the reason most people
  # are here, and it was the one thing this script told Windows users to go
  # and do themselves.
  if (Confirm-Step 'Install the Claude CLI now?') {
    try {
      Invoke-Expression (Invoke-WebRequest -UseBasicParsing `
        'https://claude.ai/install.ps1').Content
    } catch {
      Note "the installer did not finish: $_"
      Note 'install it from https://claude.ai/download, or choose OpenAI (an API key)'
    }
  } else {
    Note 'install it from https://claude.ai/download, or choose OpenAI (an API key)'
    Note 'or no agent at all on the first screen -- everything else works either way'
  }
}

# ---------------------------------------------------------------------------
Say 'The interface'

# Downloaded, not built.  Every machine used to need Node 20+ to produce an
# artefact that is identical for everyone; CI builds it once and this fetches
# the one belonging to the commit this checkout is on.  Building locally is
# still the fallback for a machine that cannot reach GitHub.
$fetched = $false
try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'fetch-interface.ps1')
  $fetched = ($LASTEXITCODE -eq 0)
} catch { $fetched = $false }

if (-not $fetched) {
  if ((Have 'node') -and ([int](((node -v) -replace '^v', '') -split '\.')[0] -ge 20)) {
    Note "building it here instead ($(node -v))"
    Push-Location frontend
    & npm ci --no-audit --no-fund --silent
    & npm run build 2>&1 | Out-Null
    Pop-Location
    Note 'built into frontend/dist'
  } elseif (Test-Path 'frontend\dist') {
    Note 'keeping the interface already built'
  } else {
    Die @'
Could not download the interface, and there is no Node here to build one.

  Check your connection, or install Node 20+ from https://nodejs.org
  or with:  winget install OpenJS.NodeJS.LTS
'@
  }
}

# ---------------------------------------------------------------------------
Say 'How it listens'

# Piped to `python -` rather than passed after it: a here-string is an
# argument, not standard input, and python would have tried to open it as
# a filename.
$configure = @'
import sys
sys.path.insert(0, ".")
from nexttex.config import Settings

settings = Settings.load()
settings.localhost = True
settings.tailscale = False
settings.save()
print("  listening: localhost")
'@
$configure | & $Venv -

# ---------------------------------------------------------------------------
Say 'Starting when you log in'

if (Confirm-Step 'Start NextTex when you log in?' 'n') {
  $task = 'NextTex'
  $action = New-ScheduledTaskAction -Execute $Venv `
    -Argument (Join-Path $Root 'server\run.py') -WorkingDirectory $Root
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -StartWhenAvailable
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger `
    -Settings $settings -Description 'NextTex LaTeX editor' | Out-Null
  Start-ScheduledTask -TaskName $task
  Note "scheduled task '$task' registered and started"
} else {
  Note "start it yourself with: .venv\Scripts\python.exe server\run.py"
}

# ---------------------------------------------------------------------------
Say 'Ready'
& $Venv server\run.py --print-url | ForEach-Object { Note $_ }
Write-Host ''
Write-Host '  That link contains your access token. Anyone with it can read and'
Write-Host '  edit your projects, so treat it like a password.'
Write-Host ''

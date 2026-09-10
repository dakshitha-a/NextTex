<#
.SYNOPSIS
  Install NextTex on Windows.

.DESCRIPTION
  A bootstrap, and nothing more. It does the three things that cannot be
  done in Python, because they happen before any Python is known to exist:
  check for git, ask where the checkout should go and clone it, and find an
  interpreter. Then it hands over to `python -m nexttex.install`, which is
  the same code Linux and macOS run: it surveys the machine, prices the
  whole job, asks once, and does the work.

  That is the point of the arrangement. Windows used to have its own
  complete second implementation of the install, and every difference
  between the two -- a state directory that was created and never used, a
  missing exit-code check after every download, options that existed on one
  platform only -- was a consequence of there being two. There is one now.

  Everything is idempotent. Run it again after installing something it said
  was missing and it picks up where it left off without touching your
  projects.

.PARAMETER Yes
  Take the defaults and ask nothing. The plan is still printed.

.PARAMETER Dir
  Where to install. The default is ~\apps\NextTex, and NEXTTEX_DIR does the
  same job. Only meaningful on a first install.

.PARAMETER Tex
  tinytex, miktex or none.

.PARAMETER Agent
  claude, openai or none. The default is none, and the app asks again on its
  first screen either way.

.PARAMETER Bind
  Where the server listens. Only localhost on Windows: the Tailscale option
  needs a TLS certificate, and that step has not been made to work here yet.
  The installer says so on screen rather than silently omitting the choice.

.PARAMETER Instance
  Install a second, separate NextTex on this machine -- its own state, its
  own port, its own logon task.

.PARAMETER NoService
  Do not arrange for NextTex to start when you log in.

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
  [string]$Dir = '',
  [ValidateSet('tinytex', 'miktex', 'none')]
  [string]$Tex = '',
  [ValidateSet('claude', 'openai', 'none')]
  [string]$Agent = '',
  [ValidateSet('localhost')]
  [string]$Bind = '',
  [string]$Instance = '',
  [switch]$NoService,
  [switch]$Plain
)

$ErrorActionPreference = 'Stop'

# The installer prints a spinner and a tick, and a console left on a legacy
# code page cannot encode either.  The installer probes its own stream and
# falls back to ASCII if it has to, but asking for UTF-8 first means the
# probe usually succeeds and the output looks the way it does everywhere
# else.
$env:PYTHONUTF8 = '1'

function Say { param([string]$Text) Write-Host ''; Write-Host "  $Text" -ForegroundColor White }
function Note { param([string]$Text) Write-Host "    $Text" }
function Die {
  param([string]$Text)
  Write-Host ''
  Write-Host $Text -ForegroundColor Red
  # `return` at the call site, not `exit`: under `irm | iex` there is no
  # script for exit to end, so it would close the window somebody is
  # watching.
  throw [System.OperationCanceledException]::new($Text)
}
function Have { param([string]$Name) return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

function Test-Interactive {
  # A scheduled task, a CI step or a remote session has nobody at the
  # keyboard, and Read-Host there either throws or blocks for ever.  Unlike
  # the shell installer this needs no /dev/tty dance: `irm | iex` hands the
  # script to the parser as a string and never touches stdin, so the console
  # is still the console.
  if ($Yes) { return $false }
  if ($env:CI) { return $false }
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

function Get-ForwardedArguments {
  # Every bound parameter except -Dir, which is already spent: by the time
  # this is forwarded we are standing in the directory it chose.
  #
  # Built from $PSBoundParameters rather than written out.  The old version
  # forwarded -Yes and -Bind and nothing else, so -Instance, -Tex and
  # -NoService were silently dropped after the clone: the second run of the
  # script never saw them, and somebody who asked for a named instance got
  # an ordinary one with no message saying why.
  $forward = @()
  foreach ($name in $PSBoundParameters.Keys) {
    if ($name -eq 'Dir') { continue }
    $value = $PSBoundParameters[$name]
    if ($value -is [switch]) {
      if ($value.IsPresent) { $forward += "-$name" }
    } elseif ($null -ne $value -and "$value" -ne '') {
      $forward += @("-$name", "$value")
    }
  }
  return $forward
}

# ---------------------------------------------------------------------------
# Two modes, one script.
#
# Run from a checkout, with `-File scripts\install.ps1`, $PSScriptRoot points
# at that checkout and we install it.  Fetched and evaluated instead, with
# the `irm ... | iex` line the README gives, the script never becomes a file
# on disk: $PSScriptRoot is the empty string, `Join-Path` refuses an empty
# Path, and the install died on its first statement with
#
#     Cannot bind argument to parameter 'Path' because it is an empty string.

$scriptDir = $PSScriptRoot
if (-not $scriptDir -and $MyInvocation.MyCommand.Path) {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

if ($scriptDir -and (Test-Path (Join-Path $scriptDir '..\requirements.txt'))) {
  Set-Location (Join-Path $scriptDir '..')
} else {
  if (-not (Have 'git')) {
    Write-Host ''
    Write-Host 'NextTex needs git.' -ForegroundColor Red
    Write-Host '  winget install --id Git.Git -e'
    return
  }

  $default = Join-Path $HOME 'apps\NextTex'
  $target = ''
  if ($Dir) { $target = $Dir }
  if (-not $target -and $env:NEXTTEX_DIR) { $target = $env:NEXTTEX_DIR }

  if (-not $target) {
    if (-not (Test-Interactive)) {
      $target = $default
    } else {
      Write-Host ''
      Write-Host '  Where should NextTex be installed?' -ForegroundColor White
      Write-Host '    Everything it needs lives in this one directory, including its'
      Write-Host '    Python environment. Your projects live outside it and are not'
      Write-Host '    touched by an install, an update or an uninstall.'
      Write-Host ''
      while (-not $target) {
        $answer = Read-Host "    Directory [$default]"
        if ([string]::IsNullOrWhiteSpace($answer)) { $answer = $default }
        $candidate = Resolve-Target $answer
        if (-not $candidate) { continue }
        # An existing checkout is fine -- that is the update path below.  So
        # is a directory that does not exist yet, and so is an empty one.
        if (Test-Path (Join-Path $candidate '.git')) { $target = $candidate; continue }
        if (-not (Test-Path $candidate)) { $target = $candidate; continue }
        if ((Test-Path $candidate -PathType Container) -and
            -not (Get-ChildItem -Force $candidate -ErrorAction SilentlyContinue)) {
          $target = $candidate
          continue
        }
        if (Test-Path $candidate -PathType Container) {
          Write-Host "    $candidate already has something in it." -ForegroundColor Red
          Write-Host '    Choose an empty directory, or an existing NextTex checkout to update.'
        } else {
          Write-Host "    $candidate is a file." -ForegroundColor Red
        }
      }
    }
  }

  $target = Resolve-Target $target
  $repo = if ($env:NEXTTEX_REPO) { $env:NEXTTEX_REPO } else { 'https://github.com/dakshitha-a/NextTex.git' }

  if (Test-Path (Join-Path $target '.git')) {
    Write-Host ''
    Write-Host "  Updating the checkout at $target" -ForegroundColor White
    & git -C $target pull --ff-only
  } else {
    Write-Host ''
    Write-Host "  Cloning into $target" -ForegroundColor White
    $parent = Split-Path -Parent $target
    if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    # Not quiet: git's own progress is the honest indicator for the one
    # download that happens before any of the installer's machinery exists.
    & git clone $repo $target
    if ($LASTEXITCODE -ne 0) {
      Write-Host ''
      Write-Host 'git could not clone NextTex.' -ForegroundColor Red
      return
    }
  }

  $forward = Get-ForwardedArguments
  # The current host's own executable rather than the string 'powershell',
  # so somebody running PowerShell 7 does not get dropped into Windows
  # PowerShell 5.1 halfway through their own install.
  $psExe = $null
  try { $psExe = (Get-Process -Id $PID).Path } catch { $psExe = $null }
  if (-not $psExe) { $psExe = 'powershell' }

  & $psExe -NoProfile -ExecutionPolicy Bypass `
      -File (Join-Path $target 'scripts\install.ps1') @forward
  return
}

# ---------------------------------------------------------------------------
# An interpreter to run the installer with.
#
# Any Python 3.10 or newer will do.  The installer is standard library only
# and makes its own virtual environment, so this does not have to be the
# Python NextTex ends up running on.

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
    $pythonExe = $exe
    $pythonArgs = $extra
    break
  }
}

if (-not $pythonExe -and (Have 'winget')) {
  Write-Host ''
  Write-Host '  There is no Python 3.10 or newer here, so NextTex will install one.'
  Write-Host ''
  & winget install --id Python.Python.3.12 --silent `
      --accept-package-agreements --accept-source-agreements
  if (Have 'python') { $pythonExe = 'python'; $pythonArgs = @() }
}

if (-not $pythonExe) {
  Write-Host ''
  Write-Host @'
NextTex needs Python 3.10 or newer, and none was found.

  Install it from https://www.python.org/downloads/ or with:
    winget install Python.Python.3.12

  Tick "Add python.exe to PATH" in the installer, then run this again.
'@ -ForegroundColor Red
  return
}

# ---------------------------------------------------------------------------
# The handover.  The same module, the same options, the same output as Linux
# and macOS get.

$installArgs = @('-m', 'nexttex.install')
if ($Yes) { $installArgs += '--yes' }
if ($Plain) { $installArgs += '--plain' }
if ($Tex) { $installArgs += "--tex=$Tex" }
if ($Agent) { $installArgs += "--agent=$Agent" }
if ($Bind) { $installArgs += "--bind=$Bind" }
if ($Instance) { $installArgs += "--instance=$Instance" }
if ($NoService) { $installArgs += '--no-service' }

& $pythonExe @pythonArgs @installArgs
exit $LASTEXITCODE

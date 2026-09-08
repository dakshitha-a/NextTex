<#
.SYNOPSIS
  Update NextTex on Windows: pull, reinstall dependencies, rebuild, restart.
#>
[CmdletBinding()]
param(
  # Set when the server itself started this: it exits with a non-zero code
  # to have the task manager restart it, so restarting it here would race
  # that and leave two of them.
  [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Say  { param($m) Write-Host ''; Write-Host $m -ForegroundColor White }
function Note { param($m) Write-Host "  $m" }

Say 'Fetching'
git pull --ff-only
Note (git log -1 --pretty='%h %s')

Say 'Dependencies'
if (Get-Command uv -ErrorAction SilentlyContinue) {
  $env:VIRTUAL_ENV = (Join-Path (Get-Location).Path '.venv')
  & uv pip install --quiet --upgrade -r requirements.txt
} else {
  & .venv\Scripts\python.exe -m pip install --quiet --upgrade -r requirements.txt
}
Note 'up to date'

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
if (Get-ScheduledTask -TaskName 'NextTex' -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName 'NextTex' -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName 'NextTex'
  Note 'restarted'
} else {
  Note 'not running as a scheduled task; restart it yourself'
}

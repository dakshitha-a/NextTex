<#
.SYNOPSIS
  Update NextTex on Windows: pull, reinstall dependencies, rebuild, restart.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Say  { param($m) Write-Host ''; Write-Host $m -ForegroundColor White }
function Note { param($m) Write-Host "  $m" }

Say 'Fetching'
git pull --ff-only
Note (git log -1 --pretty='%h %s')

Say 'Dependencies'
& .venv\Scripts\python.exe -m pip install --quiet -r requirements.txt
Note 'up to date'

Say 'Interface'
if (Get-Command node -ErrorAction SilentlyContinue) {
  Push-Location frontend
  & npm install --no-audit --no-fund --silent
  & npm run build 2>&1 | Out-Null
  Pop-Location
  Note 'rebuilt'
} else {
  Note 'no Node; keeping the interface already built'
}

Say 'Restarting'
if (Get-ScheduledTask -TaskName 'NextTex' -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName 'NextTex' -ErrorAction SilentlyContinue
  Start-ScheduledTask -TaskName 'NextTex'
  Note 'restarted'
} else {
  Note 'not running as a scheduled task; restart it yourself'
}

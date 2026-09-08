<#
.SYNOPSIS
  Fetch the interface built for the commit this checkout is on.

.DESCRIPTION
  The Windows half of scripts/fetch-interface.sh, and the same bargain: the
  install stays a git checkout, so the update button keeps working, but the
  interface inside it is built once by CI rather than on every machine.

  Writes nothing unless it succeeds. Both install.ps1 and update.ps1 fall
  back to building locally when Node is present, so a machine that cannot
  reach GitHub is inconvenienced rather than stopped.
#>
[CmdletBinding()]
param([string]$Sha = '')

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$Root = (Get-Location).Path

if (-not $Sha) { $Sha = (git rev-parse HEAD 2>$null) }
if (-not $Sha) { Write-Error 'not a git checkout'; exit 1 }
$Sha = $Sha.Trim()

# Read from the remote rather than hardcoded, so a fork fetches its own.
$remote = (git remote get-url origin 2>$null)
if (-not $remote) { Write-Error 'no origin remote'; exit 1 }
$slug = $remote.Trim() `
  -replace '^git@github\.com:', '' `
  -replace '^https://github\.com/', '' `
  -replace '\.git$', ''
if (($slug -split '/').Count -ne 2) { Write-Error "origin is not a GitHub repository: $remote"; exit 1 }

$name = "nexttex-frontend-$Sha.tar.gz"
$base = "https://github.com/$slug/releases/download/interface"
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("nexttex-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null

try {
  try {
    Invoke-WebRequest -UseBasicParsing "$base/$name" -OutFile (Join-Path $work $name)
  } catch {
    Write-Error "no interface has been published for $Sha yet"
    exit 1
  }

  # Advisory: a missing checksum is not worth refusing over, a wrong one is.
  try {
    Invoke-WebRequest -UseBasicParsing "$base/$name.sha256" -OutFile (Join-Path $work "$name.sha256")
    $expected = ((Get-Content (Join-Path $work "$name.sha256")) -split '\s+')[0]
    $actual = (Get-FileHash (Join-Path $work $name) -Algorithm SHA256).Hash.ToLower()
    if ($expected.ToLower() -ne $actual) {
      Write-Error 'the downloaded interface does not match its checksum'
      exit 1
    }
  } catch [System.Net.WebException] { }

  # tar ships with Windows 10 1803 and later.
  tar -xzf (Join-Path $work $name) -C $work
  if (-not (Test-Path (Join-Path $work 'dist\index.html'))) {
    Write-Error 'the downloaded interface has no index.html'; exit 1
  }
  $br = @(Get-ChildItem (Join-Path $work 'dist\assets') -Filter *.br -ErrorAction SilentlyContinue)
  if ($br.Count -lt 3) {
    Write-Error 'the downloaded interface has no precompressed assets'; exit 1
  }

  # Swapped rather than emptied and refilled: the server may still be
  # serving out of frontend\dist while this runs.
  $dist = Join-Path $Root 'frontend\dist'
  $incoming = Join-Path $Root 'frontend\dist.incoming'
  $previous = Join-Path $Root 'frontend\dist.previous'
  Remove-Item -Recurse -Force $incoming, $previous -ErrorAction SilentlyContinue
  Move-Item (Join-Path $work 'dist') $incoming
  if (Test-Path $dist) { Move-Item $dist $previous }
  Move-Item $incoming $dist
  Remove-Item -Recurse -Force $previous -ErrorAction SilentlyContinue

  Write-Host "  interface $($Sha.Substring(0,7)) downloaded"
} finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

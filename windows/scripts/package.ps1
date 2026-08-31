[CmdletBinding()]
param(
    [ValidateSet('win-x64', 'win-arm64')]
    [string]$Runtime = 'win-x64'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'build.ps1') -Configuration Release -Runtime $Runtime

$artifactRoot = Join-Path $root 'artifacts'
$publishRoot = Join-Path $artifactRoot $Runtime
$portable = Join-Path $artifactRoot "ShadowokxPanel-1.0.0-$Runtime-portable.zip"
if (Test-Path $portable) { Remove-Item $portable -Force }
Compress-Archive -Path (Join-Path $publishRoot '*') -DestinationPath $portable -CompressionLevel Optimal
Write-Host "Portable build: $portable"

if ($Runtime -eq 'win-x64') {
    $compiler = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($compiler) {
        & $compiler.Source "/DSourceDir=$publishRoot" (Join-Path $root 'packaging/ShadowokxPanel.iss')
    } else {
        Write-Warning 'Inno Setup was not found; the portable archive was created, but the installer was skipped.'
    }
}

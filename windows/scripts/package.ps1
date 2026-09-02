[CmdletBinding()]
param(
    [ValidateSet('Release')]
    [string]$Configuration = 'Release',
    [ValidateSet('win-x64', 'win-arm64')]
    [string]$Runtime = 'win-x64',
    [string]$CertificateThumbprint,
    [string]$SignToolPath,
    [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'release.ps1') `
    -Configuration $Configuration `
    -Runtime $Runtime `
    -CertificateThumbprint $CertificateThumbprint `
    -SignToolPath $SignToolPath `
    -TimestampUrl $TimestampUrl
if ($LASTEXITCODE -ne 0) {
    throw "Release packaging failed with exit code $LASTEXITCODE."
}

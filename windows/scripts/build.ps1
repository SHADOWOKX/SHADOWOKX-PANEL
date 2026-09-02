[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [ValidateSet('win-x64', 'win-arm64')]
    [string]$Runtime = 'win-x64'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$solution = Join-Path $root 'ShadowokxPanel.sln'
$project = Join-Path $root 'src/ShadowokxPanel/ShadowokxPanel.csproj'
$output = Join-Path $root "artifacts/$Runtime"

if (Test-Path -LiteralPath $output) {
    Remove-Item -LiteralPath $output -Recurse -Force
}

dotnet restore $solution
if ($LASTEXITCODE -ne 0) {
    throw "dotnet restore failed with exit code $LASTEXITCODE."
}

dotnet test (Join-Path $root 'tests/ShadowokxPanel.Core.Tests/ShadowokxPanel.Core.Tests.csproj') `
    --configuration $Configuration --no-restore
if ($LASTEXITCODE -ne 0) {
    throw "dotnet test failed with exit code $LASTEXITCODE."
}

dotnet publish $project `
    --configuration $Configuration `
    --runtime $Runtime `
    --self-contained true `
    --output $output `
    -p:PublishReadyToRun=true
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE."
}

& (Join-Path $PSScriptRoot 'validate-publish.ps1') `
    -PublishDirectory $output `
    -Project $project `
    -Configuration $Configuration `
    -Runtime $Runtime
if ($LASTEXITCODE -ne 0) {
    throw "Publish validation failed with exit code $LASTEXITCODE."
}

Write-Host "Published Shadowokx Panel to $output"

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
$output = Join-Path $root "artifacts/$Runtime"

dotnet restore $solution
dotnet test (Join-Path $root 'tests/ShadowokxPanel.Core.Tests/ShadowokxPanel.Core.Tests.csproj') `
    --configuration $Configuration --no-restore
dotnet publish (Join-Path $root 'src/ShadowokxPanel/ShadowokxPanel.csproj') `
    --configuration $Configuration `
    --runtime $Runtime `
    --self-contained true `
    --output $output `
    -p:PublishReadyToRun=true

Write-Host "Published Shadowokx Panel to $output"

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
if ($LASTEXITCODE -ne 0) {
    throw "dotnet restore failed with exit code $LASTEXITCODE."
}
dotnet test (Join-Path $root 'tests/ShadowokxPanel.Core.Tests/ShadowokxPanel.Core.Tests.csproj') `
    --configuration $Configuration --no-restore
if ($LASTEXITCODE -ne 0) {
    throw "dotnet test failed with exit code $LASTEXITCODE."
}
dotnet publish (Join-Path $root 'src/ShadowokxPanel/ShadowokxPanel.csproj') `
    --configuration $Configuration `
    --runtime $Runtime `
    --self-contained true `
    --output $output `
    -p:PublishReadyToRun=true
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE."
}

$executable = Join-Path $output 'ShadowokxPanel.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "dotnet publish completed without producing $executable."
}

Write-Host "Published Shadowokx Panel to $output"

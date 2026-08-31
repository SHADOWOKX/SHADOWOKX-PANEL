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

dotnet restore $solution
if ($LASTEXITCODE -ne 0) {
    throw "dotnet restore failed with exit code $LASTEXITCODE."
}

$projectMetadataOutput = & dotnet msbuild $project `
    -nologo `
    "-property:Configuration=$Configuration" `
    "-property:RuntimeIdentifier=$Runtime" `
    -getProperty:AssemblyName `
    -getProperty:ProjectPriFileName `
    -getItem:ApplicationDefinition `
    -getItem:Page
if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect WinUI project metadata; dotnet msbuild failed with exit code $LASTEXITCODE."
}

try {
    $projectMetadata = ($projectMetadataOutput -join [Environment]::NewLine) | ConvertFrom-Json
}
catch {
    throw "Unable to parse WinUI project metadata: $($_.Exception.Message)"
}

$assemblyName = [string]$projectMetadata.Properties.AssemblyName
if ([string]::IsNullOrWhiteSpace($assemblyName)) {
    throw 'The WinUI project did not report an AssemblyName.'
}

$projectPriFileName = [string]$projectMetadata.Properties.ProjectPriFileName
if ([string]::IsNullOrWhiteSpace($projectPriFileName)) {
    throw 'The WinUI project did not report a ProjectPriFileName.'
}

$xamlItems = @($projectMetadata.Items.ApplicationDefinition) + @($projectMetadata.Items.Page)
if ($xamlItems.Count -eq 0) {
    throw 'The WinUI project did not report any application XAML resources.'
}

dotnet test (Join-Path $root 'tests/ShadowokxPanel.Core.Tests/ShadowokxPanel.Core.Tests.csproj') `
    --configuration $Configuration --no-restore
if ($LASTEXITCODE -ne 0) {
    throw "dotnet test failed with exit code $LASTEXITCODE."
}

if (Test-Path -LiteralPath $output) {
    Remove-Item -LiteralPath $output -Recurse -Force
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

$requiredPublishFiles = @(
    (Join-Path $output "$assemblyName.exe"),
    (Join-Path $output "$assemblyName.dll"),
    (Join-Path $output $projectPriFileName),
    (Join-Path $output 'Assets/chatgpt.png')
)
foreach ($requiredFile in $requiredPublishFiles) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "dotnet publish completed without required runtime resource $requiredFile."
    }
}

foreach ($xamlItem in $xamlItems) {
    $xamlTarget = if ([string]::IsNullOrWhiteSpace([string]$xamlItem.Link)) {
        [string]$xamlItem.Identity
    }
    else {
        [string]$xamlItem.Link
    }
    $relativeXbf = [IO.Path]::ChangeExtension($xamlTarget, '.xbf')
    $publishedXbf = Join-Path $output $relativeXbf
    if (-not (Test-Path -LiteralPath $publishedXbf -PathType Leaf)) {
        throw "dotnet publish completed without expected application XBF resource $publishedXbf."
    }
}

Write-Host "Published Shadowokx Panel to $output"

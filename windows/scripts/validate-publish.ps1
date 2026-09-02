[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$PublishDirectory,
    [Parameter(Mandatory)]
    [string]$Project,
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [ValidateSet('win-x64', 'win-arm64')]
    [string]$Runtime = 'win-x64',
    [switch]$ReleasePayload
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PublishDirectory -PathType Container)) {
    throw "Publish directory does not exist: $PublishDirectory"
}
if (-not (Test-Path -LiteralPath $Project -PathType Leaf)) {
    throw "Application project does not exist: $Project"
}

$PublishDirectory = (Resolve-Path -LiteralPath $PublishDirectory).Path
$Project = (Resolve-Path -LiteralPath $Project).Path

$metadataOutput = & dotnet msbuild $Project `
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
    $metadata = ($metadataOutput -join [Environment]::NewLine) | ConvertFrom-Json
}
catch {
    throw "Unable to parse WinUI project metadata: $($_.Exception.Message)"
}

$assemblyName = [string]$metadata.Properties.AssemblyName
$projectPriFileName = [string]$metadata.Properties.ProjectPriFileName
if ([string]::IsNullOrWhiteSpace($assemblyName)) {
    throw 'The WinUI project did not report an AssemblyName.'
}
if ([string]::IsNullOrWhiteSpace($projectPriFileName)) {
    throw 'The WinUI project did not report a ProjectPriFileName.'
}
$expectedProjectPriFileName = "$assemblyName.pri"
if (-not $projectPriFileName.Equals($expectedProjectPriFileName, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The application PRI must be $expectedProjectPriFileName, not $projectPriFileName."
}

$xamlItems = @($metadata.Items.ApplicationDefinition) + @($metadata.Items.Page)
if ($xamlItems.Count -eq 0) {
    throw 'The WinUI project did not report any application XAML resources.'
}

$requiredFiles = @(
    "$assemblyName.exe",
    "$assemblyName.dll",
    'ShadowokxPanel.Core.dll',
    "$assemblyName.deps.json",
    "$assemblyName.runtimeconfig.json",
    $projectPriFileName,
    'Assets\chatgpt.png',
    'Assets\ShadowokxPanel.ico',
    'Assets\Weather\unknown.svg',
    'Assets\Weather\clear-day.svg',
    'Assets\Weather\clear-night.svg',
    'hostfxr.dll',
    'hostpolicy.dll',
    'coreclr.dll',
    'System.Private.CoreLib.dll',
    'Microsoft.UI.Xaml.dll',
    'Microsoft.UI.pri',
    'Microsoft.WindowsAppRuntime.Bootstrap.dll'
)
foreach ($relativePath in $requiredFiles) {
    $requiredFile = Join-Path $PublishDirectory $relativePath
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Publish output is missing required file: $relativePath"
    }
}

$obsoleteTrayAssets = Join-Path $PublishDirectory 'Assets\Tray'
if (Test-Path -LiteralPath $obsoleteTrayAssets) {
    throw 'Publish output contains obsolete static tray assets; the tray percentage is rendered dynamically.'
}

$weatherIcons = @(Get-ChildItem -LiteralPath (Join-Path $PublishDirectory 'Assets\Weather') -Filter '*.svg' -File)
if ($weatherIcons.Count -lt 14) {
    throw 'Publish output does not contain the complete app-owned weather icon set.'
}

$expectedXbf = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($xamlItem in $xamlItems) {
    $xamlTarget = if ([string]::IsNullOrWhiteSpace([string]$xamlItem.Link)) {
        [string]$xamlItem.Identity
    }
    else {
        [string]$xamlItem.Link
    }

    $relativeXbf = [IO.Path]::ChangeExtension($xamlTarget, '.xbf')
    [void]$expectedXbf.Add($relativeXbf)
    if (-not (Test-Path -LiteralPath (Join-Path $PublishDirectory $relativeXbf) -PathType Leaf)) {
        throw "Publish output is missing expected application XBF resource: $relativeXbf"
    }
}

$publishedXbf = @(Get-ChildItem -LiteralPath $PublishDirectory -Filter '*.xbf' -File -Recurse)
if ($publishedXbf.Count -lt $expectedXbf.Count) {
    throw "Publish output contains fewer application XBF files than the project declares."
}

$forbiddenDirectories = @(Get-ChildItem -LiteralPath $PublishDirectory -Directory -Recurse | Where-Object {
    $_.Name -in @('bin', 'obj', 'TestResults', 'cache', 'logs')
})
if ($forbiddenDirectories.Count -gt 0) {
    throw "Publish output contains a build-only directory: $($forbiddenDirectories[0].FullName)"
}

$forbiddenRuntimeFiles = @(Get-ChildItem -LiteralPath $PublishDirectory -File -Recurse | Where-Object {
    $_.Name -in @('settings.json', 'codex.json', 'weather.json', 'codex-history.json', 'shadowokx-panel.log')
})
if ($forbiddenRuntimeFiles.Count -gt 0) {
    throw "Publish output contains mutable user data: $($forbiddenRuntimeFiles[0].FullName)"
}

if ($ReleasePayload) {
    $symbolFiles = @(Get-ChildItem -LiteralPath $PublishDirectory -Filter '*.pdb' -File -Recurse)
    if ($symbolFiles.Count -gt 0) {
        throw "Release payload contains a developer symbol file: $($symbolFiles[0].FullName)"
    }
}

$textFiles = @(Get-ChildItem -LiteralPath $PublishDirectory -File -Recurse | Where-Object {
    $_.Extension -in @('.json', '.config', '.xml')
})
foreach ($textFile in $textFiles) {
    $content = Get-Content -LiteralPath $textFile.FullName -Raw
    if ($content -match '(?i)[A-Z]:\\Users\\[^\\]+' -or $content -match '/home/[^/]+') {
        throw "Publish output contains a machine-specific user path: $($textFile.FullName)"
    }
}

Write-Host "Validated resource-complete, self-contained publish output: $PublishDirectory"

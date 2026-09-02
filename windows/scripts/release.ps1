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
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'src/ShadowokxPanel/ShadowokxPanel.csproj'
$publishRoot = Join-Path $root "artifacts/$Runtime"
$releaseRoot = Join-Path $root 'artifacts/release'
$payloadRoot = Join-Path $root "artifacts/release-input/$Runtime"
$installerScript = Join-Path $root 'packaging/ShadowokxPanel.iss'
$architecture = $Runtime.Substring(4)

if (Test-Path -LiteralPath $releaseRoot) {
    Remove-Item -LiteralPath $releaseRoot -Recurse -Force
}
if (Test-Path -LiteralPath $payloadRoot) {
    Remove-Item -LiteralPath $payloadRoot -Recurse -Force
}

function Find-InnoSetupCompiler {
    $command = Get-Command 'ISCC.exe' -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
        $candidates += Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'
    }
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $candidates += Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'
    }

    $innoCandidate = $candidates |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
    return $innoCandidate
}

function Find-SignTool {
    if (-not [string]::IsNullOrWhiteSpace($SignToolPath)) {
        if (-not (Test-Path -LiteralPath $SignToolPath -PathType Leaf)) {
            throw "The configured SignTool does not exist: $SignToolPath"
        }
        return (Resolve-Path -LiteralPath $SignToolPath).Path
    }
    if (-not [string]::IsNullOrWhiteSpace($env:SHADOWOKX_SIGNTOOL)) {
        if (-not (Test-Path -LiteralPath $env:SHADOWOKX_SIGNTOOL -PathType Leaf)) {
            throw "SHADOWOKX_SIGNTOOL does not point to a file: $env:SHADOWOKX_SIGNTOOL"
        }
        return (Resolve-Path -LiteralPath $env:SHADOWOKX_SIGNTOOL).Path
    }

    $command = Get-Command 'signtool.exe' -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
        $kitsRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
        if (Test-Path -LiteralPath $kitsRoot -PathType Container) {
            $signToolCandidate = Get-ChildItem -LiteralPath $kitsRoot -Filter 'signtool.exe' -File -Recurse |
                Where-Object { $_.DirectoryName -like '*\x64' } |
                Sort-Object FullName -Descending |
                Select-Object -ExpandProperty FullName -First 1
            return $signToolCandidate
        }
    }

    return $null
}

$innoCompiler = $null
if ($Runtime -eq 'win-x64') {
    $innoCompiler = Find-InnoSetupCompiler
    if ([string]::IsNullOrWhiteSpace($innoCompiler)) {
        throw 'Inno Setup 6 is required for the x64 release. Install it or add ISCC.exe to PATH.'
    }
}

$effectiveThumbprint = if (-not [string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
    $CertificateThumbprint
}
else {
    $env:SHADOWOKX_SIGN_CERT_THUMBPRINT
}
$signTool = $null
if (-not [string]::IsNullOrWhiteSpace($effectiveThumbprint)) {
    $signTool = Find-SignTool
    if ([string]::IsNullOrWhiteSpace($signTool)) {
        throw 'A signing certificate was configured, but signtool.exe could not be found.'
    }
}

function Invoke-SignFile([string]$FilePath) {
    if ([string]::IsNullOrWhiteSpace($effectiveThumbprint)) {
        return
    }

    & $signTool sign /sha1 $effectiveThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $FilePath
    if ($LASTEXITCODE -ne 0) {
        throw "Authenticode signing failed for $FilePath with exit code $LASTEXITCODE."
    }
    & $signTool verify /pa $FilePath
    if ($LASTEXITCODE -ne 0) {
        throw "Authenticode verification failed for $FilePath with exit code $LASTEXITCODE."
    }
}

& (Join-Path $PSScriptRoot 'build.ps1') -Configuration $Configuration -Runtime $Runtime
if ($LASTEXITCODE -ne 0) {
    throw "The Windows build failed with exit code $LASTEXITCODE."
}

$versionOutput = & dotnet msbuild $project -nologo `
    "-property:Configuration=$Configuration" `
    "-property:RuntimeIdentifier=$Runtime" `
    -getProperty:Version `
    -getProperty:VersionPrefix
if ($LASTEXITCODE -ne 0) {
    throw "Unable to read release version; dotnet msbuild failed with exit code $LASTEXITCODE."
}
try {
    $versionMetadata = ($versionOutput -join [Environment]::NewLine) | ConvertFrom-Json
}
catch {
    throw "Unable to parse release version metadata: $($_.Exception.Message)"
}
$version = [string]$versionMetadata.Properties.VersionPrefix
if ([string]::IsNullOrWhiteSpace($version)) {
    $version = [string]$versionMetadata.Properties.Version
}
if ([string]::IsNullOrWhiteSpace($version)) {
    throw 'The project did not report a release version.'
}

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null
Copy-Item -Path (Join-Path $publishRoot '*') -Destination $payloadRoot -Recurse -Force
Get-ChildItem -LiteralPath $payloadRoot -Filter '*.pdb' -File -Recurse | Remove-Item -Force

Invoke-SignFile (Join-Path $payloadRoot 'ShadowokxPanel.exe')

& (Join-Path $PSScriptRoot 'validate-publish.ps1') `
    -PublishDirectory $payloadRoot `
    -Project $project `
    -Configuration $Configuration `
    -Runtime $Runtime `
    -ReleasePayload
if ($LASTEXITCODE -ne 0) {
    throw "Release payload validation failed with exit code $LASTEXITCODE."
}

$portable = Join-Path $releaseRoot "ShadowokxPanel-Portable-$architecture.zip"
Compress-Archive -Path (Join-Path $payloadRoot '*') -DestinationPath $portable -CompressionLevel Optimal
if (-not (Test-Path -LiteralPath $portable -PathType Leaf)) {
    throw "Portable archive was not created: $portable"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($portable)
try {
    $archiveEntries = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $archive.Entries) {
        [void]$archiveEntries.Add($entry.FullName.Replace('\', '/'))
    }
    foreach ($payloadFile in (Get-ChildItem -LiteralPath $payloadRoot -File -Recurse)) {
        $relativePath = $payloadFile.FullName.Substring($payloadRoot.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
        if (-not $archiveEntries.Contains($relativePath)) {
            throw "Portable archive is missing release payload file: $relativePath"
        }
    }
    $symbolEntries = @($archiveEntries | Where-Object {
        $_.EndsWith('.pdb', [StringComparison]::OrdinalIgnoreCase)
    })
    if ($symbolEntries.Count -gt 0) {
        throw 'Portable archive contains developer symbol files.'
    }
}
finally {
    $archive.Dispose()
}

$releaseArtifacts = [Collections.Generic.List[string]]::new()
if ($Runtime -eq 'win-x64') {
    $installerBaseName = 'ShadowokxPanel-Setup-x64'
    & $innoCompiler `
        "/DSourceDir=$payloadRoot" `
        "/DOutputDir=$releaseRoot" `
        "/DOutputBaseFilename=$installerBaseName" `
        "/DAppVersion=$version" `
        $installerScript
    if ($LASTEXITCODE -ne 0) {
        throw "Inno Setup failed with exit code $LASTEXITCODE."
    }

    $installer = Join-Path $releaseRoot "$installerBaseName.exe"
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
        throw "Inno Setup succeeded without creating the expected installer: $installer"
    }
    Invoke-SignFile $installer
    $releaseArtifacts.Add($installer)
}
else {
    Write-Warning 'ARM64 currently produces the portable artifact only; the recommended installer is win-x64.'
}
$releaseArtifacts.Add($portable)

$checksumPath = Join-Path $releaseRoot 'checksums.txt'
$checksumLines = @(
    foreach ($artifact in $releaseArtifacts) {
        $hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $([IO.Path]::GetFileName($artifact))"
    }
)
[IO.File]::WriteAllLines($checksumPath, [string[]]$checksumLines, [Text.UTF8Encoding]::new($false))

if ([string]::IsNullOrWhiteSpace($effectiveThumbprint)) {
    Write-Warning 'Release artifacts are unsigned. Windows may show an Unknown publisher/SmartScreen warning until a trusted Authenticode certificate is configured.'
}

Write-Host "Release version: $version"
Write-Host "Validated payload: $payloadRoot"
foreach ($artifact in $releaseArtifacts) {
    Write-Host "Release artifact: $artifact"
}
Write-Host "Checksums: $checksumPath"

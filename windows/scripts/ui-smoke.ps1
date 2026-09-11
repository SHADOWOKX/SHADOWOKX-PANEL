param([string]$Executable = "$PSScriptRoot/../artifacts/win-x64/ShadowokxPanel.exe")
$ErrorActionPreference = 'Stop'
$process = Start-Process -FilePath $Executable -ArgumentList '--ui-smoke' -PassThru
if (-not $process.WaitForExit(60000)) {
    Stop-Process -Id $process.Id -Force
    throw 'UI smoke timed out.'
}
if ($process.ExitCode -ne 0) {
    Get-Content "$env:TEMP/ShadowokxPanel-startup.log" -ErrorAction SilentlyContinue
    throw "UI smoke exited with $($process.ExitCode)."
}
$report = Join-Path $env:TEMP 'ShadowokxPanel-ui-smoke/report.json'
if (-not (Test-Path $report)) { throw 'UI smoke did not produce its report.' }
Get-Content $report

$destination = Join-Path $PSScriptRoot '../artifacts/ui-smoke'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item "$env:TEMP/ShadowokxPanel-ui-smoke/*" $destination -Force
Copy-Item "$env:TEMP/ShadowokxPanel-startup.log" $destination -Force -ErrorAction SilentlyContinue

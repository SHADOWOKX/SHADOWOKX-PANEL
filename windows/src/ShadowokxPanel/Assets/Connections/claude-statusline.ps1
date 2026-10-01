param([string]$OutputPath, [string]$PreviousFile)
$original = [Console]::In.ReadToEnd()
try {
    $payload = $original | ConvertFrom-Json
    $rates = @{}
    foreach ($name in @('five_hour','seven_day','spend_limit')) {
        $window = $payload.rate_limits.$name
        if ($null -ne $window) {
            $fields = @{}
            if ($null -ne $window.used_percentage) { $fields.used_percentage = $window.used_percentage }
            if ($null -ne $window.resets_at) { $fields.resets_at = $window.resets_at }
            $rates[$name] = $fields
        }
    }
    $export = @{ updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); rate_limits = $rates }
    $temporary = $OutputPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    [IO.File]::WriteAllText($temporary, ($export | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $OutputPath -Force
    if (Test-Path -LiteralPath $PreviousFile) {
        $previous = [IO.File]::ReadAllText($PreviousFile)
        $start = [Diagnostics.ProcessStartInfo]::new('cmd.exe')
        $start.Arguments = '/d /s /c "' + $previous + '"'
        $start.UseShellExecute = $false; $start.CreateNoWindow = $true
        $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
        $process = [Diagnostics.Process]::Start($start)
        $output = $process.StandardOutput.ReadToEndAsync(); $errors = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.Write($original); $process.StandardInput.Close()
        if ($process.WaitForExit(5000)) { $text = $output.GetAwaiter().GetResult(); if ($text) { [Console]::Write($text); return } }
        else { $process.Kill() }
        $process.Dispose()
    }
    'Claude | Usage connected'
} catch { 'Claude | Usage unavailable' }

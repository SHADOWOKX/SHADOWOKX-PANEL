using System.Text.Json;
using System.Runtime.InteropServices.WindowsRuntime;
using Microsoft.UI.Xaml.Media.Imaging;
using ShadowokxPanel.Core.Codex;
using ShadowokxPanel.Core.Models;
using ShadowokxPanel.Core.Settings;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

namespace ShadowokxPanel;

public sealed partial class MainWindow
{
    // Explicit opt-in diagnostic mode uses an isolated profile and never starts providers.
    internal async Task RunSmokeAsync()
    {
        await _host.Settings.SaveAsync(new AppSettings { Theme = ThemePreset.Shadow, RememberLastPage = false });
        var now = DateTimeOffset.Now;
        var day = DateOnly.FromDateTime(now.LocalDateTime);
        var usage = new TokenUsage(1_500_000_000, 742900, 46_900_000, day.AddDays(-5),
            Enumerable.Range(0, 7).Select(i => new UsageBucket(day.AddDays(i - 6), i < 2 ? 46_900_000 : 742900)).ToArray(), 95_000_000);
        usage = usage with { AccountDailyBuckets = usage.DailyBuckets };
        var codex = new CodexState
        {
            Status = ProviderStatus.Success, Weekly = new(51, 49, now.AddDays(4), 10080), TokenUsage = usage,
            LastSuccessfulRefresh = now,
        };
        var condition = new WeatherCondition("Mainly clear", "partly-cloudy-day");
        var weather = new WeatherState
        {
            Status = ProviderStatus.Success, Location = "Port Said, Egypt", Current = new(30, 32, 60, 16, 0, condition),
            Today = new(30, 25, 7, now.Date.AddHours(6), now.Date.AddHours(19)), LastSuccessfulRefresh = now,
            Forecast = Enumerable.Range(1, 4).Select(i => new ForecastHour(now.AddHours(i), 31-i, 0, condition)).ToArray(),
        };
        _viewModel.ApplyPreview(codex, weather);
        ShowPanel();
        await Task.Delay(300);
        var rows = new List<object>();
        foreach (var percent in new[] { 0, 1, 15, 33, 49, 60, 67, 85, 98, 100 })
        {
            _viewModel.ApplyPreview(codex with { Weekly = new(100-percent, percent, now.AddDays(4), 10080) }, weather);
            await _viewModel.SelectPageAsync("weather");
            await Task.Delay(40);
            await _viewModel.SelectPageAsync("codex");
            await Task.Delay(60);
            Root.UpdateLayout();
            var expected = WeeklyTrack.ActualWidth * percent / 100;
            var actual = percent == 0 ? 0 : WeeklyFill.ActualWidth;
            if (Math.Abs(actual - expected) > 1.1)
                throw new InvalidOperationException($"Progress remap failed at {percent}: {actual}/{WeeklyTrack.ActualWidth}");
            rows.Add(new { percent, actual, expected });
        }
        _viewModel.ApplyPreview(codex, weather);
        await Task.Delay(100);
        var output = Path.Combine(Path.GetTempPath(), "ShadowokxPanel-ui-smoke");
        Directory.CreateDirectory(output);
        if (TodayCost.Text != ExactTokens(742900) || MonthCost.Text == "—")
            throw new InvalidOperationException("Account rows did not render remote tokens.");
        var shared = await ShareUsageAsync(output, openFolder: false);
        if (shared is null || !CopyUsageButton.IsEnabled)
            throw new InvalidOperationException("Share export failed or button stayed disabled.");
        var saved = await Windows.Storage.StorageFile.GetFileFromPathAsync(shared);
        using (var image = await saved.OpenReadAsync())
        {
            var decoder = await BitmapDecoder.CreateAsync(image);
            if (decoder.PixelWidth == 0 || decoder.PixelHeight == 0)
                throw new InvalidOperationException("Shared PNG is empty.");
        }
        if (await ShareUsageAsync(shared, openFolder: false) is not null || !CopyUsageButton.IsEnabled)
            throw new InvalidOperationException("Share did not recover from an invalid destination.");
        UpdateRelativeTimeLabels();
        await CaptureAsync(Path.Combine(output, "codex.png"));
        var codexOverflow = CodexScroll.ScrollableHeight;
        var codexConstrained = _heightConstrained;
        await _viewModel.SelectPageAsync("weather");
        await Task.Delay(150);
        await CaptureAsync(Path.Combine(output, "weather.png"));
        var weatherOverflow = WeatherScroll.ScrollableHeight;
        if (Root.ActualHeight >= 680 && ((codexOverflow > 1 && !codexConstrained) || (weatherOverflow > 1 && !_heightConstrained)))
            throw new InvalidOperationException($"Normal content overflow: Codex {codexOverflow}, Weather {weatherOverflow}");
        if (ProviderTabs.Children.Count != 8) throw new InvalidOperationException("Provider logo tabs missing.");
        var mascotPath = Path.Combine(AppContext.BaseDirectory, "Assets", "Companions", "octopus", "waving-00.ico");
        foreach (var size in new[] { 16, 32, 64 })
        foreach (int? percent in new int?[] { 0, 11, 100, null })
        {
            int[]? pixels = null;
            var icon = Platform.TrayIconRenderer.Create(size, percent, mascotPath, value => pixels = value);
            Platform.NativeMethods.DestroyIcon(icon);
            if (pixels is null || !pixels.Take(size * size / 2).Any(pixel => ((uint)pixel >> 24) != 0) ||
                !pixels.Skip(size * size * 2 / 3).Any(pixel => pixel == -1))
                throw new InvalidOperationException("Combined tray badge lost its companion or allowance.");
            using var trayStream = new InMemoryRandomAccessStream();
            var trayEncoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, trayStream);
            var trayBytes = new byte[pixels.Length * sizeof(int)];
            System.Buffer.BlockCopy(pixels, 0, trayBytes, 0, trayBytes.Length);
            trayEncoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, (uint)size, (uint)size, 96, 96, trayBytes);
            await trayEncoder.FlushAsync();
            using var trayReader = new DataReader(trayStream.GetInputStreamAt(0));
            await trayReader.LoadAsync((uint)trayStream.Size);
            var png = new byte[(int)trayStream.Size]; trayReader.ReadBytes(png);
            await File.WriteAllBytesAsync(Path.Combine(output, $"tray-{size}-{percent?.ToString() ?? "unknown"}.png"), png);
        }
        var originalSettings = _host.Settings.Current;
        foreach (var single in new[] { "codex", "claude" })
        {
            await _host.Settings.SaveAsync(originalSettings with { VisibleProviders = [single], RemovedProviders = [], SelectedProvider = single, ShowWeather = false });
            Render();
            if (ProviderBorder.Visibility != Microsoft.UI.Xaml.Visibility.Collapsed)
                throw new InvalidOperationException("Single-page navigation remained visible.");
            await _host.Settings.SaveAsync(_host.Settings.Current with { ShowWeather = true });
            Render();
            if (ProviderTabs.Children.Count != 2 || ProviderBorder.Visibility != Microsoft.UI.Xaml.Visibility.Visible)
                throw new InvalidOperationException("Provider and weather did not share navigation.");
        }
        await _host.Settings.SaveAsync(originalSettings);
        Render();
        var settingsPreview = new SettingsWindow(_host);
        settingsPreview.Activate();
        try
        {
            foreach (var category in new[] { "General", "Appearance", "Accounts" })
            {
                settingsPreview.SelectCategory(category);
                await Task.Delay(250);
                using var preview = await CreateImageAsync(settingsPreview.PreviewRoot);
                using var previewReader = new DataReader(preview.GetInputStreamAt(0));
                await previewReader.LoadAsync((uint)preview.Size);
                var previewBytes = new byte[(int)preview.Size];
                previewReader.ReadBytes(previewBytes);
                await File.WriteAllBytesAsync(Path.Combine(output, $"settings-{category.ToLowerInvariant()}.png"), previewBytes);
            }
        }
        finally { settingsPreview.Close(); }
        ShowPanel();
        var claudePath = _host.AI.DefaultPath("claude");
        Directory.CreateDirectory(Path.GetDirectoryName(claudePath)!);
        await File.WriteAllTextAsync(claudePath, JsonSerializer.Serialize(new
        {
            updatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            windows = new[] { new { label = "Weekly allowance", usedPercent = 35 } },
            activity = new { active = true, updatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() },
        }));
        await _host.Settings.SaveAsync(_host.Settings.Current with { SelectedProvider = "claude" });
        await _host.AI.RefreshAsync();
        await _viewModel.SelectPageAsync("codex");
        await Task.Delay(2300);
        Render();
        if (AIScroll.Visibility != Microsoft.UI.Xaml.Visibility.Visible ||
            !AIContent.Children.OfType<Microsoft.UI.Xaml.Controls.Border>().Any(border =>
                border.Child is Microsoft.UI.Xaml.Controls.StackPanel stack &&
                stack.Children.OfType<Microsoft.UI.Xaml.Controls.TextBlock>().Any(text => text.Text == "65% remaining")))
            throw new InvalidOperationException("Selected provider allowance did not render.");
        if (_uiSettings.AnimationsEnabled && (!_companion.IsWorking || !_companion.MotionRunning))
            throw new InvalidOperationException("Reported work did not animate.");
        if (!_uiSettings.AnimationsEnabled && _companion.MotionRunning)
            throw new InvalidOperationException("Reduced-motion preference was ignored.");
        await CaptureAsync(Path.Combine(output, "claude.png"));
        await File.WriteAllTextAsync(claudePath, JsonSerializer.Serialize(new
        {
            updatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            windows = new[] { new { label = "Weekly allowance", usedPercent = 35 } },
            activity = new { active = false, updatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() },
        }));
        await _host.AI.RefreshAsync();
        await Task.Delay(2300);
        if (_companion.IsWorking || _companion.MotionRunning) throw new InvalidOperationException("Idle companion kept animating.");
        await _host.Settings.SaveAsync(_host.Settings.Current with { SelectedProvider = "codex" });
        File.Delete(claudePath);
        for (var i = 0; i < 20; i++) { HidePanel(); ShowPanel(); await Task.Delay(10); }
        HidePanel();
        if (_clockTimer.IsEnabled || CodexRefreshRing.IsActive || WeatherRefreshRing.IsActive)
            throw new InvalidOperationException("Hidden UI still has active animation timers.");
        using var process = System.Diagnostics.Process.GetCurrentProcess();
        process.Refresh();
        var cpuBefore = process.TotalProcessorTime;
        await Task.Delay(3000);
        process.Refresh();
        await File.WriteAllTextAsync(Path.Combine(output, "report.json"), JsonSerializer.Serialize(new
        { accountHistoryHeatmapRendered = true, accountRowsFromRemote = true, sharePngDecoded = true, shareErrorRecovered = true, progress = rows, codexOverflow, weatherOverflow, reopenCycles = 20, hiddenClockStopped = true,
            hiddenCpuMillisecondsOver3Seconds = (process.TotalProcessorTime - cpuBefore).TotalMilliseconds,
            privateBytes = process.PrivateMemorySize64, handles = process.HandleCount }));
    }

    private async Task CaptureAsync(string file)
    {
        using var stream = await CreateImageAsync(Root);
        using var reader = new DataReader(stream.GetInputStreamAt(0));
        await reader.LoadAsync((uint)stream.Size);
        var bytes = new byte[(int)stream.Size];
        reader.ReadBytes(bytes);
        await File.WriteAllBytesAsync(file, bytes);
    }
    private static async Task<InMemoryRandomAccessStream> CreateImageAsync(Microsoft.UI.Xaml.FrameworkElement visual)
    {
        var bitmap = new RenderTargetBitmap();
        await bitmap.RenderAsync(visual);
        var pixels = await bitmap.GetPixelsAsync();
        var stream = new InMemoryRandomAccessStream();
        var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
        encoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied,
            (uint)bitmap.PixelWidth, (uint)bitmap.PixelHeight, 96, 96, pixels.ToArray());
        await encoder.FlushAsync();
        stream.Seek(0);
        return stream;
    }

}

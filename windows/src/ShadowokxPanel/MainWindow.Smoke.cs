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
        if (TodayCost.Text != Core.Presentation.AccountCostEstimate.Format(742900, _host.Settings.Current, System.Globalization.CultureInfo.CurrentCulture) || MonthCost.Text == "Not reported")
            throw new InvalidOperationException("Account rows did not render remote tokens.");
        var mix = _host.Settings.Current with { EstimateCachedPercent = 90, EstimateOutputPercent = 2, EstimateWritePercent = 1 };
        RenderCodex(codex, mix);
        if (!TodayCost.Text.StartsWith("≈$0.81", StringComparison.Ordinal))
            throw new InvalidOperationException("Mixed-price account estimate did not update.");
        RenderCodex(codex, _host.Settings.Current);
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
        await _viewModel.SelectPageAsync("weather");
        await Task.Delay(150);
        await CaptureAsync(Path.Combine(output, "weather.png"));
        var weatherOverflow = WeatherScroll.ScrollableHeight;
        if (Root.ActualHeight >= 680 && (codexOverflow > 1 || weatherOverflow > 1))
            throw new InvalidOperationException($"Normal content overflow: Codex {codexOverflow}, Weather {weatherOverflow}");
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
        { officialPriceEstimateRendered = true, accountRowsFromRemote = true, sharePngDecoded = true, shareErrorRecovered = true, progress = rows, codexOverflow, weatherOverflow, reopenCycles = 20, hiddenClockStopped = true,
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

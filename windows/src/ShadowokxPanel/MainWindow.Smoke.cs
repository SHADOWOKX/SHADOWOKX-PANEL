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
        var codex = new CodexState
        {
            Status = ProviderStatus.Success, Weekly = new(51, 49, now.AddDays(4), 10080), TokenUsage = usage,
            LastSuccessfulRefresh = now,
            Cost = new(new(34.12m, 24_900_000, 0), new(0, 0, 0), new(412.97m, 615_500_000, 0), now, false),
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
        await CaptureAsync(Path.Combine(output, "codex.png"));
        var codexOverflow = CodexScroll.ScrollableHeight;
        await _viewModel.SelectPageAsync("weather");
        await Task.Delay(150);
        await CaptureAsync(Path.Combine(output, "weather.png"));
        var weatherOverflow = WeatherScroll.ScrollableHeight;
        for (var i = 0; i < 20; i++) { HidePanel(); ShowPanel(); await Task.Delay(10); }
        HidePanel();
        if (_clockTimer.IsEnabled || CodexRefreshRing.IsActive || WeatherRefreshRing.IsActive)
            throw new InvalidOperationException("Hidden UI still has active animation timers.");
        await File.WriteAllTextAsync(Path.Combine(output, "report.json"), JsonSerializer.Serialize(new
        { progress = rows, codexOverflow, weatherOverflow, reopenCycles = 20, hiddenClockStopped = true }));
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

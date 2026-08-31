using System.ComponentModel;
using System.Globalization;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using ShadowokxPanel.Core.History;
using ShadowokxPanel.Core.Models;
using ShadowokxPanel.Platform;
using ShadowokxPanel.Services;
using ShadowokxPanel.ViewModels;
using Windows.Graphics;
using Windows.UI.ViewManagement;

namespace ShadowokxPanel;

public sealed partial class MainWindow : Window, IDisposable
{
    private readonly AppHost _host;
    private readonly DashboardViewModel _viewModel;
    private readonly AppWindow _appWindow;
    private readonly nint _hwnd;
    private readonly DispatcherTimer _clockTimer;
    private readonly UISettings _uiSettings = new();
    private IReadOnlyList<ForecastHour> _renderedForecast = [];
    private string? _renderedForecastTimeZone;
    private bool _renderedForecastPrecipitation;
    private TrayIcon? _tray;
    private SettingsWindow? _settingsWindow;
    private bool _visible;
    private bool _exiting;
    private bool _disposed;

    public MainWindow(AppHost host)
    {
        _host = host;
        InitializeComponent();
        _hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(_hwnd);
        _appWindow = AppWindow.GetFromWindowId(windowId);
        if (_appWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.SetBorderAndTitleBar(false, false);
            presenter.IsAlwaysOnTop = true;
            presenter.IsResizable = false;
            presenter.IsMaximizable = false;
            presenter.IsMinimizable = false;
        }
        _appWindow.Title = "Shadowokx Panel";
        _appWindow.Closing += AppWindow_Closing;
        Activated += MainWindow_Activated;

        _viewModel = new DashboardViewModel(host, DispatcherQueue);
        _viewModel.PropertyChanged += ViewModel_PropertyChanged;
        _clockTimer = new DispatcherTimer { Interval = TimeSpan.FromMinutes(1) };
        _clockTimer.Tick += ClockTimer_Tick;
        ThemeService.Apply(Root, _host.Settings.Current);
        Render();
    }

    public void InitializeTray()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_tray is not null)
            return;
        _tray = new TrayIcon(
            _hwnd,
            TogglePanel,
            () => _ = _viewModel.RefreshAllAsync(),
            OpenSettings,
            ToggleStartup,
            () => _ = ((App)Application.Current).ExitAsync("tray menu"),
            () => _ = _host.ResumeAsync(),
            ThemeService.AccentColor(_host.Settings.Current));
        UpdateTray();
    }

    public void ShowPanel()
    {
        if (_disposed)
            return;
        PositionNearTray();
        _appWindow.Show();
        Activate();
        _visible = true;
        _clockTimer.Start();
        if (_host.Settings.Current.RefreshOnOpen)
            _ = _viewModel.RefreshAllAsync(false);
        Render();
    }

    private void TogglePanel()
    {
        if (_visible)
            HidePanel();
        else
            ShowPanel();
    }

    private void HidePanel()
    {
        if (!_visible)
            return;
        _visible = false;
        _clockTimer.Stop();
        _appWindow.Hide();
    }

    private void AppWindow_Closing(AppWindow sender, AppWindowClosingEventArgs eventArgs)
    {
        if (!_exiting)
        {
            eventArgs.Cancel = true;
            HidePanel();
        }
    }

    private void MainWindow_Activated(object sender, WindowActivatedEventArgs eventArgs)
    {
        if (_visible && eventArgs.WindowActivationState == WindowActivationState.Deactivated &&
            _settingsWindow is null)
            HidePanel();
    }

    private void ClockTimer_Tick(object? sender, object eventArgs) => Render();

    private void PositionNearTray()
    {
        NativeMethods.GetCursorPos(out var cursor);
        var monitor = NativeMethods.MonitorFromPoint(cursor, NativeMethods.MonitorDefaultToNearest);
        var info = new NativeMethods.MonitorInfo
        {
            cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf<NativeMethods.MonitorInfo>(),
        };
        NativeMethods.GetMonitorInfo(monitor, ref info);
        var scale = Math.Max(1, NativeMethods.GetDpiForWindow(_hwnd)) / 96d;
        var width = (int)Math.Round((_host.Settings.Current.Density ==
            Core.Settings.LayoutDensity.Compact ? 400 : 430) * scale);
        var height = (int)Math.Round((_host.Settings.Current.Density ==
            Core.Settings.LayoutDensity.Compact ? 650 : 720) * scale);
        height = Math.Min(height, info.rcWork.Bottom - info.rcWork.Top - (int)(12 * scale));
        var margin = (int)Math.Round(10 * scale);
        var x = Math.Clamp(cursor.X - width + margin,
            info.rcWork.Left + margin, info.rcWork.Right - width - margin);
        var y = Math.Clamp(cursor.Y - height - margin,
            info.rcWork.Top + margin, info.rcWork.Bottom - height - margin);
        _appWindow.MoveAndResize(new RectInt32(x, y, width, height));
    }

    private void Render()
    {
        var settings = _viewModel.Settings;
        ThemeService.Apply(Root, settings);
        WeatherTab.Visibility = settings.ShowWeather ? Visibility.Visible : Visibility.Collapsed;
        WeatherColumn.Width = settings.ShowWeather ? new GridLength(1, GridUnitType.Star) : new GridLength(0);
        SegmentedBorder.Visibility = settings.ShowWeather ? Visibility.Visible : Visibility.Collapsed;
        var weatherSelected = settings.ShowWeather && _viewModel.SelectedPage == "weather";
        CodexScroll.Visibility = weatherSelected ? Visibility.Collapsed : Visibility.Visible;
        WeatherScroll.Visibility = weatherSelected ? Visibility.Visible : Visibility.Collapsed;
        CodexTab.Background = weatherSelected ? Transparent() : ResourceBrush("AccentBrush", 0.22);
        WeatherTab.Background = weatherSelected ? ResourceBrush("AccentBrush", 0.22) : Transparent();
        RenderCodex(_viewModel.Codex, settings);
        RenderWeather(_viewModel.Weather, settings);
        UpdateTray();
    }

    private void RenderCodex(CodexState state, Core.Settings.AppSettings settings)
    {
        var hasData = state.HasData;
        CodexErrorCard.Visibility = !hasData && state.Status == ProviderStatus.Error
            ? Visibility.Visible : Visibility.Collapsed;
        CodexContent.Visibility = hasData ? Visibility.Visible : Visibility.Collapsed;
        CodexErrorTitle.Text = state.ErrorCode == "not-installed"
            ? "Codex not detected" : state.ErrorCode == "unsupported-response"
                ? "Unsupported Codex response" : "Codex usage unavailable";
        CodexErrorMessage.Text = state.ErrorMessage ?? "No usage data has been reported yet.";
        var refreshing = state.Status is ProviderStatus.Loading or ProviderStatus.Refreshing;
        var animateRefresh = refreshing && settings.Animations && _uiSettings.AnimationsEnabled;
        CodexRefreshRing.IsActive = animateRefresh;
        CodexRefreshRing.Visibility = animateRefresh ? Visibility.Visible : Visibility.Collapsed;
        CodexRefreshIcon.Visibility = animateRefresh ? Visibility.Collapsed : Visibility.Visible;
        CodexRefreshButton.IsEnabled = !refreshing;
        if (!hasData)
            return;

        var weekly = state.Weekly;
        WeeklyCard.Visibility = weekly is null ? Visibility.Collapsed : Visibility.Visible;
        if (weekly is not null)
        {
            WeeklyRemaining.Text = $"{Math.Round(weekly.RemainingPercent):0}%";
            WeeklyProgress.Value = weekly.RemainingPercent;
            WeeklyUsed.Text = $"{Math.Round(weekly.UsedPercent):0}% used";
            WeeklyAvailable.Text = $"{Math.Round(weekly.RemainingPercent):0}% available";
            CapacityLabel.Text = UsageAnalytics.CapacityLabel(weekly.RemainingPercent);
            WeeklyCountdown.Text = FormatCountdown(weekly.ResetsAt);
            WeeklyResetDate.Text = weekly.ResetsAt?.LocalDateTime.ToString(
                "ddd t", CultureInfo.CurrentCulture) ?? "Reset unavailable";
        }

        var fiveHour = state.FiveHour;
        FiveHourText.Text = fiveHour is null
            ? "Not reported by this Codex session."
            : $"{Math.Round(fiveHour.RemainingPercent):0}% remaining";
        FiveHourPill.Text = fiveHour is null ? "Unavailable" :
            UsageAnalytics.CapacityLabel(fiveHour.RemainingPercent);
        FiveHourReset.Text = fiveHour is null ? string.Empty : FormatCountdown(fiveHour.ResetsAt);

        TokenCard.Visibility = settings.ShowLifetimeTokens || settings.ShowTokenHistory
            ? Visibility.Visible : Visibility.Collapsed;
        var usage = state.TokenUsage;
        LifetimeTokens.Visibility = settings.ShowLifetimeTokens ? Visibility.Visible : Visibility.Collapsed;
        LifetimeTokens.Text = FormatTokens(usage?.LifetimeTokens);
        TokenGraph.Visibility = settings.ShowTokenHistory ? Visibility.Visible : Visibility.Collapsed;
        TokenGraph.SetData(usage?.DailyBuckets);
        PeakTokens.Text = FormatTokens(usage?.PeakDailyTokens);
        PeakDate.Text = usage?.PeakDate?.ToString(
            "MMM d, yyyy", CultureInfo.CurrentCulture) ?? "Not reported";
        ResetCredits.Text = $"Reset credits: {state.ResetCreditsAvailable}";
        CodexUpdated.Text = FormatUpdated(state.LastSuccessfulRefresh, state.IsStale);
    }

    private void RenderWeather(WeatherState state, Core.Settings.AppSettings settings)
    {
        var hasData = state.HasData;
        WeatherErrorCard.Visibility = !hasData && state.Status == ProviderStatus.Error
            ? Visibility.Visible : Visibility.Collapsed;
        WeatherContent.Visibility = hasData ? Visibility.Visible : Visibility.Collapsed;
        WeatherErrorMessage.Text = state.ErrorMessage ?? "No forecast has been received yet.";
        var refreshing = state.Status is ProviderStatus.Loading or ProviderStatus.Refreshing;
        var animateRefresh = refreshing && settings.Animations && _uiSettings.AnimationsEnabled;
        WeatherRefreshRing.IsActive = animateRefresh;
        WeatherRefreshRing.Visibility = animateRefresh ? Visibility.Visible : Visibility.Collapsed;
        WeatherRefreshIcon.Visibility = animateRefresh ? Visibility.Collapsed : Visibility.Visible;
        WeatherRefreshButton.IsEnabled = !refreshing;
        if (!hasData || state.Current is null || state.Today is null)
            return;

        var suffix = state.Unit == "fahrenheit" ? "°F" : "°C";
        WeatherTemperature.Text = $"{Math.Round(state.Current.Temperature):0}°";
        WeatherCondition.Text = state.Current.Condition.Label;
        WeatherLocation.Text = CompactLocation(state.Location);
        WeatherHeroIcon.Glyph = WeatherGlyph(state.Current.Condition.Symbol);
        WeatherHighLow.Text = $"H{Math.Round(state.Today.High):0}° · L{Math.Round(state.Today.Low):0}°";
        FeelsLike.Text = $"{Math.Round(state.Current.FeelsLike):0}{suffix}";
        Humidity.Text = $"{Math.Round(state.Current.Humidity):0}%";
        var wind = settings.WindUnit == "mph" ? state.Current.Wind * 0.621371 : state.Current.Wind;
        Wind.Text = $"{Math.Round(wind):0} {(settings.WindUnit == "mph" ? "mph" : "km/h")}";
        Rain.Text = state.Current.RainProbability.HasValue
            ? $"{Math.Round(state.Current.RainProbability.Value):0}%" : "Unavailable";
        UvIndex.Text = state.Today.Uv.HasValue
            ? $"{state.Today.Uv.Value:0.#} · {UvSeverity(state.Today.Uv.Value)}" : "Unavailable";
        UvIndex.Visibility = settings.ShowUv ? Visibility.Visible : Visibility.Collapsed;
        if (!_renderedForecast.SequenceEqual(state.Forecast) ||
            _renderedForecastTimeZone != state.TimeZone ||
            _renderedForecastPrecipitation != settings.ShowHourlyPrecipitation)
        {
            ForecastRow.Children.Clear();
            foreach (var hour in state.Forecast)
            {
                var item = new StackPanel
                {
                    Width = 66,
                    Spacing = 4,
                    HorizontalAlignment = HorizontalAlignment.Center,
                };
                item.Children.Add(new TextBlock
                {
                    Text = LocationTime(hour.Time, state.TimeZone).ToString(
                        "t", CultureInfo.CurrentCulture),
                    FontSize = 11,
                    Foreground = ResourceBrush("SecondaryTextBrush"),
                    HorizontalAlignment = HorizontalAlignment.Center,
                });
                item.Children.Add(new FontIcon
                {
                    Glyph = WeatherGlyph(hour.Condition.Symbol),
                    FontSize = 16,
                    Foreground = ResourceBrush("PrimaryTextBrush"),
                });
                item.Children.Add(new TextBlock
                {
                    Text = $"{Math.Round(hour.Temperature):0}°",
                    FontSize = 13,
                    FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                    Foreground = ResourceBrush("PrimaryTextBrush"),
                    HorizontalAlignment = HorizontalAlignment.Center,
                });
                if (settings.ShowHourlyPrecipitation && hour.PrecipitationChance.HasValue)
                {
                    item.Children.Add(new TextBlock
                    {
                        Text = $"{Math.Round(hour.PrecipitationChance.Value):0}%",
                        FontSize = 10,
                        Foreground = ResourceBrush("SecondaryTextBrush"),
                        HorizontalAlignment = HorizontalAlignment.Center,
                    });
                }
                ForecastRow.Children.Add(item);
            }
            _renderedForecast = state.Forecast.ToArray();
            _renderedForecastTimeZone = state.TimeZone;
            _renderedForecastPrecipitation = settings.ShowHourlyPrecipitation;
        }
        Sunrise.Text = state.Today.Sunrise.HasValue
            ? $"Sunrise {LocationTime(state.Today.Sunrise.Value, state.TimeZone).ToString("t", CultureInfo.CurrentCulture)}"
            : "Sunrise unavailable";
        Sunset.Text = state.Today.Sunset.HasValue
            ? $"Sunset {LocationTime(state.Today.Sunset.Value, state.TimeZone).ToString("t", CultureInfo.CurrentCulture)}"
            : "Sunset unavailable";
        WeatherUpdated.Text = FormatUpdated(state.LastSuccessfulRefresh, state.IsStale);
    }

    private void UpdateTray()
    {
        if (_tray is null)
            return;
        var state = _viewModel.Codex;
        var remaining = state.Weekly?.RemainingPercent ?? state.FiveHour?.RemainingPercent;
        var pace = _viewModel.Settings.ShowCodexStateIndicator ? _viewModel.UsagePace : UsagePace.Unknown;
        var lines = new List<string> { "Shadowokx Panel" };
        lines.Add(remaining.HasValue
            ? $"Codex: {Math.Round(remaining.Value):0}% remaining" +
                (pace != UsagePace.Unknown ? $" · {pace}" : string.Empty)
            : "Codex: unavailable");
        if (_viewModel.Settings.ShowWeatherInTrayTooltip && _viewModel.Weather.Current is { } weather)
            lines.Add($"Weather: {Math.Round(weather.Temperature):0}° · {weather.Condition.Label}");
        var iconPace = _viewModel.Settings.ChangeTrayIconWithUsageState ? pace : UsagePace.Unknown;
        _tray.Update(string.Join('\n', lines), iconPace, ThemeService.AccentColor(_viewModel.Settings));
    }

    private void OpenSettings()
    {
        HidePanel();
        if (_settingsWindow is not null)
        {
            _settingsWindow.Activate();
            return;
        }
        _settingsWindow = new SettingsWindow(_host);
        _settingsWindow.Closed += (_, _) => _settingsWindow = null;
        _settingsWindow.Activate();
    }

    private async void ToggleStartup()
    {
        try
        {
            var enabled = !StartupService.IsEnabled();
            StartupService.SetEnabled(enabled);
            await _host.Settings.SaveAsync(
                _host.Settings.Current with { StartWithWindows = enabled });
        }
        catch (Exception error) when (error is UnauthorizedAccessException or
            System.Security.SecurityException or IOException)
        {
            // The context menu remains responsive if startup registration is policy-blocked.
        }
    }

    private void ViewModel_PropertyChanged(object? sender, PropertyChangedEventArgs eventArgs)
    {
        if (_visible)
            Render();
        else
            UpdateTray();
    }

    private async void CodexTab_Click(object sender, RoutedEventArgs e)
    {
        try { await _viewModel.SelectPageAsync("codex"); }
        catch (IOException) { }
    }

    private async void WeatherTab_Click(object sender, RoutedEventArgs e)
    {
        try { await _viewModel.SelectPageAsync("weather"); }
        catch (IOException) { }
    }

    private async void CodexRefreshButton_Click(object sender, RoutedEventArgs e)
    {
        try { await _viewModel.RefreshCodexAsync(); }
        catch (OperationCanceledException) { }
    }

    private async void WeatherRefreshButton_Click(object sender, RoutedEventArgs e)
    {
        try { await _viewModel.RefreshWeatherAsync(); }
        catch (OperationCanceledException) { }
    }

    private void SettingsButton_Click(object sender, RoutedEventArgs e) => OpenSettings();

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _exiting = true;
        _visible = false;
        _clockTimer.Stop();
        _clockTimer.Tick -= ClockTimer_Tick;
        _appWindow.Closing -= AppWindow_Closing;
        Activated -= MainWindow_Activated;
        _viewModel.PropertyChanged -= ViewModel_PropertyChanged;
        _tray?.Dispose();
        _tray = null;
        _viewModel.Dispose();
        var settingsWindow = _settingsWindow;
        _settingsWindow = null;
        settingsWindow?.Close();
        Close();
        GC.SuppressFinalize(this);
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);

    private static SolidColorBrush ResourceBrush(string name, double opacity = 1)
    {
        var brush = (SolidColorBrush)Application.Current.Resources[name];
        return opacity >= 1 ? brush : new SolidColorBrush(brush.Color) { Opacity = opacity };
    }

    private static string FormatTokens(long? value) => value switch
    {
        null => "Not reported",
        >= 1_000_000_000 => value.Value.ToString("0.#,,,'B'", CultureInfo.CurrentCulture),
        >= 1_000_000 => value.Value.ToString("0.#,,'M'", CultureInfo.CurrentCulture),
        >= 1_000 => value.Value.ToString("0.#,'K'", CultureInfo.CurrentCulture),
        _ => value.Value.ToString("N0", CultureInfo.CurrentCulture),
    };

    private static string FormatCountdown(DateTimeOffset? reset)
    {
        if (!reset.HasValue)
            return "Reset unavailable";
        var remaining = reset.Value - DateTimeOffset.Now;
        if (remaining <= TimeSpan.Zero)
            return "Reset due now";
        return remaining.TotalDays >= 1
            ? $"Resets in {(int)remaining.TotalDays}d {remaining.Hours}h"
            : $"Resets in {(int)remaining.TotalHours}h {remaining.Minutes}m";
    }

    private static string FormatUpdated(DateTimeOffset? value, bool stale)
    {
        if (!value.HasValue)
            return "Not updated yet";
        var age = DateTimeOffset.Now - value.Value;
        var relative = age.TotalMinutes < 1 ? "just now" : age.TotalHours < 1
            ? $"{(int)age.TotalMinutes}m ago" : $"{(int)age.TotalHours}h ago";
        return $"Updated {relative}{(stale ? " · Cached" : string.Empty)}";
    }

    private static string CompactLocation(string value)
    {
        var parts = value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return parts.Length <= 2 ? string.Join(", ", parts) : $"{parts[0]}, {parts[^1]}";
    }

    private static string UvSeverity(double value) => value switch
    {
        < 3 => "Low",
        < 6 => "Moderate",
        < 8 => "High",
        < 11 => "Very high",
        _ => "Extreme",
    };

    private static string WeatherGlyph(string symbol) => symbol switch
    {
        "sun" => "\uE706",
        "partly-cloudy" => "\uE9BD",
        "cloud" => "\uE753",
        "fog" => "\uE9B8",
        "drizzle" => "\uE9C4",
        "rain" => "\uE9C4",
        "snow" => "\uE9C7",
        "storm" => "\uE9C6",
        _ => "\uE7BA",
    };

    private static DateTime LocationTime(DateTimeOffset value, string? zone)
    {
        if (!string.IsNullOrWhiteSpace(zone))
        {
            try { return TimeZoneInfo.ConvertTime(value, TimeZoneInfo.FindSystemTimeZoneById(zone)).DateTime; }
            catch (TimeZoneNotFoundException) { }
            catch (InvalidTimeZoneException) { }
        }
        return value.LocalDateTime;
    }
}

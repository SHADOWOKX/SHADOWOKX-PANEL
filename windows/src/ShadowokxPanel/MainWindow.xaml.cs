using System.ComponentModel;
using System.Globalization;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using ShadowokxPanel.Controls;
using ShadowokxPanel.Core.History;
using ShadowokxPanel.Core.Models;
using ShadowokxPanel.Platform;
using ShadowokxPanel.Services;
using ShadowokxPanel.ViewModels;
using Windows.Graphics;
using Windows.Foundation;
using Windows.UI.ViewManagement;
using Windows.System;

namespace ShadowokxPanel;

public sealed partial class MainWindow : Window, IDisposable
{
    private readonly AppHost _host;
    private readonly DashboardViewModel _viewModel;
    private readonly AppWindow _appWindow;
    private readonly nint _hwnd;
    private readonly DispatcherTimer _clockTimer;
    private readonly TokenGraphControl _tokenGraph;
    private readonly UISettings _uiSettings = new();
    private IReadOnlyList<ForecastHour> _renderedForecast = [];
    private string? _renderedForecastTimeZone;
    private bool _renderedForecastPrecipitation;
    private TrayIcon? _tray;
    private SettingsWindow? _settingsWindow;
    private bool _visible;
    private bool _exiting;
    private bool _disposed;
    private int _positionedHeight;
    private int? _codexNaturalHeight;
    private int? _weatherNaturalHeight;
    private bool _contentResizeQueued;
    private NativeMethods.Point _anchorPoint;
    private bool _hasAnchorPoint;

    public MainWindow(AppHost host)
    {
        _host = host;
        StartupDiagnostics.Write("MainWindow InitializeComponent start");
        try
        {
            InitializeComponent();
        }
        catch (Exception error)
        {
            StartupDiagnostics.WriteException("MainWindow InitializeComponent failed", error);
            throw;
        }
        StartupDiagnostics.Write("MainWindow InitializeComponent successful");

        StartupDiagnostics.Write("TokenGraphControl construction start");
        _tokenGraph = new TokenGraphControl();
        TokenGraphHost.Children.Add(_tokenGraph);
        StartupDiagnostics.Write("graph construction successful");
        _hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        ConfigureUtilityWindow();
        var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(_hwnd);
        _appWindow = AppWindow.GetFromWindowId(windowId);
        _appWindow.IsShownInSwitchers = false;
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
            () =>
            {
                if (_host.ProvidersReady)
                    _ = _viewModel.RefreshAllAsync();
            },
            OpenSettings,
            ToggleStartup,
            () => _ = ((App)Application.Current).ExitAsync("tray menu"),
            () =>
            {
                if (_host.ProvidersReady)
                    _ = _host.ResumeAsync();
            });
        UpdateTray();
    }

    public void ShowPanel()
    {
        if (_disposed)
            return;
        _visible = true;
        var codexVisible = _viewModel.SelectedPage != "weather" ||
            !_viewModel.Settings.ShowWeather;
        _host.Codex.SetVisible(codexVisible);
        Render();
        PositionNearTray();
        _appWindow.Show();
        Activate();
        _clockTimer.Start();
        if (codexVisible && _host.ProvidersReady)
            _ = _viewModel.RefreshCodexAsync();
        else if (_host.ProvidersReady && _host.Settings.Current.RefreshOnOpen)
            _ = _host.Weather.RefreshAsync(false);
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
        _host.Codex.SetVisible(false);
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

    private void ClockTimer_Tick(object? sender, object eventArgs) => UpdateRelativeTimeLabels();

    private void Root_KeyDown(object sender, KeyRoutedEventArgs eventArgs)
    {
        if (eventArgs.Key != VirtualKey.Escape)
            return;
        eventArgs.Handled = true;
        HidePanel();
    }

    private void ConfigureUtilityWindow()
    {
        var extended = NativeMethods.GetWindowLongPtr(_hwnd, NativeMethods.GwlExStyle).ToInt64();
        var utility = (extended | NativeMethods.WsExToolWindow) & ~NativeMethods.WsExAppWindow;
        if (utility != extended)
        {
            System.Runtime.InteropServices.Marshal.SetLastPInvokeError(0);
            var previous = NativeMethods.SetWindowLongPtr(
                _hwnd, NativeMethods.GwlExStyle, new nint(utility));
            if (previous == 0 && System.Runtime.InteropServices.Marshal.GetLastPInvokeError() != 0)
                throw new InvalidOperationException("The panel utility-window style could not be applied.");
            if (!NativeMethods.SetWindowPos(
                _hwnd,
                0,
                0,
                0,
                0,
                0,
                NativeMethods.SwpNoActivate | NativeMethods.SwpNoMove |
                    NativeMethods.SwpNoSize | NativeMethods.SwpNoZOrder |
                    NativeMethods.SwpFrameChanged))
                throw new InvalidOperationException("The panel utility-window frame could not be updated.");
        }
        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
        {
            var borderColor = NativeMethods.DwmColorNone;
            _ = NativeMethods.DwmSetWindowAttribute(
                _hwnd,
                NativeMethods.DwmwaBorderColor,
                ref borderColor,
                sizeof(int));
            var cornerPreference = NativeMethods.DwmwcpRound;
            _ = NativeMethods.DwmSetWindowAttribute(
                _hwnd,
                NativeMethods.DwmwaWindowCornerPreference,
                ref cornerPreference,
                sizeof(int));
        }
    }

    private void PositionNearTray(bool captureAnchor = true)
    {
        if ((captureAnchor || !_hasAnchorPoint) && NativeMethods.GetCursorPos(out var point))
        {
            _anchorPoint = point;
            _hasAnchorPoint = true;
        }
        var cursor = _anchorPoint;
        var monitor = NativeMethods.MonitorFromPoint(cursor, NativeMethods.MonitorDefaultToNearest);
        var info = new NativeMethods.MonitorInfo
        {
            cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf<NativeMethods.MonitorInfo>(),
        };
        if (!NativeMethods.GetMonitorInfo(monitor, ref info))
            return;
        var dpi = NativeMethods.GetDpiForMonitor(monitor, 0, out var monitorDpi, out _) == 0
            ? monitorDpi : NativeMethods.GetDpiForWindow(_hwnd);
        var scale = Math.Max(96, dpi) / 96d;
        var margin = (int)Math.Round(10 * scale);
        var width = (int)Math.Round((_host.Settings.Current.Density ==
            Core.Settings.LayoutDensity.Compact ? 400 : 430) * scale);
        var desiredHeight = DesiredPanelHeight();
        var height = (int)Math.Round(desiredHeight * scale);
        width = Math.Min(width, Math.Max(1, info.rcWork.Right - info.rcWork.Left - margin * 2));
        height = Math.Min(height, Math.Max(1, info.rcWork.Bottom - info.rcWork.Top - margin * 2));
        var taskbarBottom = info.rcWork.Bottom < info.rcMonitor.Bottom;
        var taskbarTop = info.rcWork.Top > info.rcMonitor.Top;
        var taskbarLeft = info.rcWork.Left > info.rcMonitor.Left;
        var taskbarRight = info.rcWork.Right < info.rcMonitor.Right;
        var x = taskbarLeft ? info.rcWork.Left + margin : taskbarRight
            ? info.rcWork.Right - width - margin : cursor.X - width + margin;
        var y = taskbarTop ? info.rcWork.Top + margin : taskbarBottom
            ? info.rcWork.Bottom - height - margin : cursor.Y - height + margin;
        x = Math.Clamp(x, info.rcWork.Left + margin, info.rcWork.Right - width - margin);
        y = Math.Clamp(y, info.rcWork.Top + margin, info.rcWork.Bottom - height - margin);
        _appWindow.MoveAndResize(new RectInt32(x, y, width, height));
        _positionedHeight = desiredHeight;
    }

    private int DesiredPanelHeight()
    {
        var compact = _host.Settings.Current.Density == Core.Settings.LayoutDensity.Compact;
        var weather = _host.Settings.Current.ShowWeather && _viewModel.SelectedPage == "weather";
        var measured = weather ? _weatherNaturalHeight : _codexNaturalHeight;
        if (measured.HasValue)
            return measured.Value;
        if (weather)
            return _viewModel.Weather.HasData ? (compact ? 600 : 660) : (compact ? 340 : 360);
        if (!_viewModel.Codex.HasData)
            return compact ? 340 : 360;
        var height = compact ? 610 : 690;
        if (!_host.Settings.Current.ShowTokenHistory)
            height -= compact ? 90 : 105;
        if (!_host.Settings.Current.ShowLifetimeTokens)
            height -= compact ? 35 : 40;
        return height;
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
        QueueContentResize();
    }

    private void RenderCodex(CodexState state, Core.Settings.AppSettings settings)
    {
        var hasData = state.HasData;
        CodexErrorCard.Visibility = !hasData ? Visibility.Visible : Visibility.Collapsed;
        CodexContent.Visibility = hasData ? Visibility.Visible : Visibility.Collapsed;
        CodexErrorTitle.Text = state.Status == ProviderStatus.Loading ? "Loading Codex usage" :
            state.ErrorCode switch
            {
                "not-installed" => "Codex not detected",
                "start-failed" => "Codex could not start",
                "authentication-required" => "Codex needs sign-in",
                "app-server-failed" => "Codex service unavailable",
                "unsupported-response" => "Unsupported Codex response",
                "timeout" => "Codex timed out",
                _ => "Codex usage unavailable",
            };
        CodexErrorMessage.Text = state.Status == ProviderStatus.Loading
            ? "Checking this Windows user’s Codex installation…"
            : state.ErrorMessage ?? "No usage data has been reported yet.";
        var refreshing = state.Status is ProviderStatus.Loading or ProviderStatus.Refreshing;
        var animateRefresh = refreshing && settings.Animations && _uiSettings.AnimationsEnabled;
        CodexRefreshRing.IsActive = animateRefresh;
        CodexRefreshRing.Visibility = animateRefresh ? Visibility.Visible : Visibility.Collapsed;
        CodexRefreshIcon.Visibility = animateRefresh ? Visibility.Collapsed : Visibility.Visible;
        CodexRefreshButton.IsEnabled = !refreshing;
        CodexInitialProgress.IsActive = animateRefresh && !hasData;
        CodexInitialProgress.Visibility = animateRefresh && !hasData
            ? Visibility.Visible : Visibility.Collapsed;
        CodexRetryButton.Visibility = state.Status == ProviderStatus.Error
            ? Visibility.Visible : Visibility.Collapsed;
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
        LifetimeTokensLabel.Visibility = LifetimeTokens.Visibility;
        LifetimeTokens.Text = FormatTokens(usage?.LifetimeTokens);
        _tokenGraph.Visibility = settings.ShowTokenHistory ? Visibility.Visible : Visibility.Collapsed;
        TokenGraphHost.Visibility = _tokenGraph.Visibility;
        _tokenGraph.SetData(usage?.DailyBuckets);
        TodayTokens.Text = FormatTokens(usage?.TodayTokens);
        PeakTokens.Text = FormatTokens(usage?.PeakDailyTokens);
        PeakDate.Text = usage?.PeakDate?.ToString(
            "MMM d, yyyy", CultureInfo.CurrentCulture) ?? "Not reported";
        ResetCredits.Text = $"Reset credits: {state.ResetCreditsAvailable}";
        CodexUpdated.Text = FormatUpdated(state.LastSuccessfulRefresh, state.IsStale);
    }

    private void RenderWeather(WeatherState state, Core.Settings.AppSettings settings)
    {
        var hasData = state.HasData;
        WeatherErrorCard.Visibility = !hasData ? Visibility.Visible : Visibility.Collapsed;
        WeatherContent.Visibility = hasData ? Visibility.Visible : Visibility.Collapsed;
        WeatherErrorTitle.Text = state.Status == ProviderStatus.Loading
            ? "Loading weather" : "Weather unavailable";
        WeatherErrorMessage.Text = state.Status == ProviderStatus.Loading
            ? "Contacting Open-Meteo…"
            : state.ErrorMessage ?? "No forecast has been received yet.";
        var refreshing = state.Status is ProviderStatus.Loading or ProviderStatus.Refreshing;
        var animateRefresh = refreshing && settings.Animations && _uiSettings.AnimationsEnabled;
        WeatherRefreshRing.IsActive = animateRefresh;
        WeatherRefreshRing.Visibility = animateRefresh ? Visibility.Visible : Visibility.Collapsed;
        WeatherRefreshIcon.Visibility = animateRefresh ? Visibility.Collapsed : Visibility.Visible;
        WeatherRefreshButton.IsEnabled = !refreshing;
        WeatherInitialProgress.IsActive = animateRefresh && !hasData;
        WeatherInitialProgress.Visibility = animateRefresh && !hasData
            ? Visibility.Visible : Visibility.Collapsed;
        WeatherRetryButton.Visibility = state.Status == ProviderStatus.Error
            ? Visibility.Visible : Visibility.Collapsed;
        if (!hasData || state.Current is null || state.Today is null)
            return;

        var suffix = state.Unit == "fahrenheit" ? "°F" : "°C";
        WeatherTemperature.Text = $"{Math.Round(state.Current.Temperature):0}°";
        WeatherCondition.Text = state.Current.Condition.Label;
        WeatherLocation.Text = CompactLocation(state.Location);
        WeatherIconAssets.Set(WeatherHeroIcon, state.Current.Condition.Symbol);
        WeatherHighLow.Text = $"H{Math.Round(state.Today.High):0}° · L{Math.Round(state.Today.Low):0}°";
        FeelsLike.Text = $"{Math.Round(state.Current.FeelsLike):0}{suffix}";
        Humidity.Text = $"{Math.Round(state.Current.Humidity):0}%";
        var wind = settings.WindUnit == "mph" ? state.Current.Wind * 0.621371 : state.Current.Wind;
        Wind.Text = $"{Math.Round(wind):0} {(settings.WindUnit == "mph" ? "mph" : "km/h")}";
        Rain.Text = state.Current.RainProbability.HasValue
            ? $"{Math.Round(state.Current.RainProbability.Value):0}%" : "Unavailable";
        UvIndex.Text = state.Today.Uv.HasValue
            ? $"{state.Today.Uv.Value:0.#} · {UvSeverity(state.Today.Uv.Value)}" : "Unavailable";
        UvRow.Visibility = settings.ShowUv ? Visibility.Visible : Visibility.Collapsed;
        ForecastEmpty.Visibility = state.Forecast.Count == 0
            ? Visibility.Visible : Visibility.Collapsed;
        ForecastRow.Visibility = state.Forecast.Count == 0
            ? Visibility.Collapsed : Visibility.Visible;
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
                item.Children.Add(WeatherIconAssets.Create(hour.Condition.Symbol, 18));
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
        int? displayedPercent = remaining.HasValue
            ? (int)Math.Round(remaining.Value, MidpointRounding.AwayFromZero) : null;
        _tray.Update(
            string.Join('\n', lines),
            displayedPercent,
            _viewModel.Settings.ChangeTrayIconWithUsageState);
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
        // Codex changes already include the derived pace in the same render. Ignore the
        // second derived-property notification so one provider sample causes one UI pass.
        if (eventArgs.PropertyName == nameof(DashboardViewModel.UsagePace))
            return;
        var settingsChanged = eventArgs.PropertyName == nameof(DashboardViewModel.Settings);
        if (settingsChanged)
        {
            _codexNaturalHeight = null;
            _weatherNaturalHeight = null;
        }
        if (_visible)
        {
            _host.Codex.SetVisible(_viewModel.SelectedPage != "weather" ||
                !_viewModel.Settings.ShowWeather);
            Render();
            if (settingsChanged || _positionedHeight != DesiredPanelHeight())
                PositionNearTray(captureAnchor: false);
        }
        else
            UpdateTray();
    }

    private async void CodexTab_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            await _viewModel.SelectPageAsync("codex");
            _host.Codex.SetVisible(_visible);
            if (_visible && _host.ProvidersReady)
                await _viewModel.RefreshCodexAsync();
        }
        catch (IOException) { }
    }

    private async void WeatherTab_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            await _viewModel.SelectPageAsync("weather");
            _host.Codex.SetVisible(false);
            if (_visible && _host.ProvidersReady)
                await _host.Weather.RefreshAsync(false);
        }
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

    private void UpdateRelativeTimeLabels()
    {
        var codex = _viewModel.Codex;
        if (codex.HasData)
        {
            CodexUpdated.Text = FormatUpdated(codex.LastSuccessfulRefresh, codex.IsStale);
            if (codex.Weekly is { } weekly)
                WeeklyCountdown.Text = FormatCountdown(weekly.ResetsAt);
            if (codex.FiveHour is { } fiveHour)
                FiveHourReset.Text = FormatCountdown(fiveHour.ResetsAt);
        }
        var weather = _viewModel.Weather;
        if (weather.HasData)
            WeatherUpdated.Text = FormatUpdated(weather.LastSuccessfulRefresh, weather.IsStale);
    }

    private void QueueContentResize()
    {
        if (!_visible || _disposed || _contentResizeQueued)
            return;
        _contentResizeQueued = true;
        if (!DispatcherQueue.TryEnqueue(
            Microsoft.UI.Dispatching.DispatcherQueuePriority.Low,
            MeasureAndFitContent))
            _contentResizeQueued = false;
    }

    private void MeasureAndFitContent()
    {
        _contentResizeQueued = false;
        if (!_visible || _disposed)
            return;
        Root.UpdateLayout();
        var weather = _host.Settings.Current.ShowWeather && _viewModel.SelectedPage == "weather";
        var scroll = weather ? WeatherScroll : CodexScroll;
        if (scroll.Content is not FrameworkElement content ||
            scroll.ActualWidth <= 0 || scroll.ActualHeight <= 0 || Root.ActualHeight <= 0)
            return;

        content.Measure(new Size(scroll.ActualWidth, float.PositiveInfinity));
        var naturalHeight = Root.ActualHeight - scroll.ActualHeight + content.DesiredSize.Height;
        if (!double.IsFinite(naturalHeight) || naturalHeight <= 0)
            return;
        var measured = (int)Math.Ceiling(naturalHeight);
        var changed = weather
            ? _weatherNaturalHeight != measured
            : _codexNaturalHeight != measured;
        if (!changed)
            return;
        if (weather)
            _weatherNaturalHeight = measured;
        else
            _codexNaturalHeight = measured;
        if (_positionedHeight != measured)
            PositionNearTray(captureAnchor: false);
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _exiting = true;
        _visible = false;
        _host.Codex.SetVisible(false);
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

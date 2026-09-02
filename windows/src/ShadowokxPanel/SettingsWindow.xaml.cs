using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using ShadowokxPanel.Core.Settings;
using ShadowokxPanel.Platform;
using ShadowokxPanel.Services;
using Windows.Graphics;

namespace ShadowokxPanel;

public sealed partial class SettingsWindow : Window
{
    private readonly AppHost _host;
    private readonly AppWindow _appWindow;
    private bool _loading;

    public SettingsWindow(AppHost host)
    {
        _host = host;
        InitializeComponent();
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        _appWindow = AppWindow.GetFromWindowId(Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd));
        _appWindow.Title = "Shadowokx Panel Settings";
        _appWindow.Resize(new SizeInt32(560, 760));
        LoadValues(host.Settings.Current);
        ThemeService.Apply(Root, host.Settings.Current);
    }

    private void LoadValues(AppSettings settings)
    {
        _loading = true;
        StartWithWindowsToggle.IsOn = StartupService.IsEnabled();
        ShowWeatherToggle.IsOn = settings.ShowWeather;
        CodexStateToggle.IsOn = settings.ShowCodexStateIndicator;
        WeatherTooltipToggle.IsOn = settings.ShowWeatherInTrayTooltip;
        RefreshOnOpenToggle.IsOn = settings.RefreshOnOpen;
        ThemeCombo.SelectedIndex = (int)settings.Theme;
        AccentCombo.SelectedIndex = (int)settings.Accent;
        CustomAccentBox.Text = settings.CustomAccent;
        DensityCombo.SelectedIndex = settings.Density == LayoutDensity.Compact ? 0 : 1;
        AnimationsToggle.IsOn = settings.Animations;
        LifetimeToggle.IsOn = settings.ShowLifetimeTokens;
        HistoryToggle.IsOn = settings.ShowTokenHistory;
        UsageStateToggle.IsOn = settings.ShowUsageState;
        LocationBox.Text = settings.WeatherLocation;
        TemperatureCombo.SelectedIndex = settings.TemperatureUnit == "fahrenheit" ? 1 : 0;
        WindCombo.SelectedIndex = settings.WindUnit == "mph" ? 1 : 0;
        UvToggle.IsOn = settings.ShowUv;
        PrecipitationToggle.IsOn = settings.ShowHourlyPrecipitation;
        WeatherInterval.Value = settings.WeatherRefreshMinutes;
        DebugToggle.IsOn = settings.DebugLogging;
        CustomAccentBox.IsEnabled = settings.Accent == AccentPreset.Custom;
        _loading = false;
    }

    private void SettingChanged(object sender, RoutedEventArgs eventArgs) => _ = SaveSettingsAsync();

    private void SelectionChanged(object sender, SelectionChangedEventArgs eventArgs) =>
        _ = SaveSettingsAsync();

    private void NumberChanged(NumberBox sender, NumberBoxValueChangedEventArgs eventArgs) =>
        _ = SaveSettingsAsync();

    private async Task SaveSettingsAsync()
    {
        if (_loading)
            return;
        var theme = Enum.IsDefined(typeof(ThemePreset), ThemeCombo.SelectedIndex)
            ? (ThemePreset)ThemeCombo.SelectedIndex : ThemePreset.System;
        var accent = Enum.IsDefined(typeof(AccentPreset), AccentCombo.SelectedIndex)
            ? (AccentPreset)AccentCombo.SelectedIndex : AccentPreset.Rose;
        var next = _host.Settings.Current with
        {
            StartWithWindows = StartWithWindowsToggle.IsOn,
            ShowWeather = ShowWeatherToggle.IsOn,
            ShowCodexStateIndicator = CodexStateToggle.IsOn,
            ShowWeatherInTrayTooltip = WeatherTooltipToggle.IsOn,
            RefreshOnOpen = RefreshOnOpenToggle.IsOn,
            Theme = theme,
            Accent = accent,
            CustomAccent = CustomAccentBox.Text,
            Density = DensityCombo.SelectedIndex == 0 ? LayoutDensity.Compact : LayoutDensity.Comfortable,
            Animations = AnimationsToggle.IsOn,
            ShowLifetimeTokens = LifetimeToggle.IsOn,
            ShowTokenHistory = HistoryToggle.IsOn,
            ShowUsageState = UsageStateToggle.IsOn,
            WeatherLocation = LocationBox.Text,
            TemperatureUnit = TemperatureCombo.SelectedIndex == 1 ? "fahrenheit" : "celsius",
            WindUnit = WindCombo.SelectedIndex == 1 ? "mph" : "kmh",
            ShowUv = UvToggle.IsOn,
            ShowHourlyPrecipitation = PrecipitationToggle.IsOn,
            WeatherRefreshMinutes = double.IsFinite(WeatherInterval.Value)
                ? (int)Math.Round(WeatherInterval.Value) : 30,
            DebugLogging = DebugToggle.IsOn,
        };
        try
        {
            StartupService.SetEnabled(next.StartWithWindows);
            await _host.Settings.SaveAsync(next);
            CustomAccentBox.IsEnabled = next.Accent == AccentPreset.Custom;
            ThemeService.Apply(Root, _host.Settings.Current);
        }
        catch (Exception error) when (error is UnauthorizedAccessException or IOException or
            ArgumentException or System.Security.SecurityException)
        {
            LoadValues(_host.Settings.Current);
        }
    }

    private async void ClearHistory_Click(object sender, RoutedEventArgs eventArgs)
    {
        var dialog = new ContentDialog
        {
            XamlRoot = Root.XamlRoot,
            Title = "Clear local token history?",
            Content = "Current Codex limits are not affected. A new graph will begin with future real samples.",
            PrimaryButtonText = "Clear",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Close,
        };
        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        {
            try { await _host.ClearHistoryAsync(); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                await ShowStorageErrorAsync("Token history could not be cleared.");
            }
        }
    }

    private async void ResetAppearance_Click(object sender, RoutedEventArgs eventArgs)
    {
        var current = _host.Settings.Current;
        var defaults = new AppSettings();
        var next = current with
        {
            Theme = defaults.Theme,
            Accent = defaults.Accent,
            CustomAccent = defaults.CustomAccent,
            Density = defaults.Density,
            Animations = defaults.Animations,
        };
        try
        {
            await _host.Settings.SaveAsync(next);
            LoadValues(next);
            ThemeService.Apply(Root, next);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            await ShowStorageErrorAsync("Appearance settings could not be reset.");
        }
    }

    private async Task ShowStorageErrorAsync(string message)
    {
        var dialog = new ContentDialog
        {
            XamlRoot = Root.XamlRoot,
            Title = "Shadowokx Panel",
            Content = message,
            CloseButtonText = "Close",
        };
        await dialog.ShowAsync();
    }
}

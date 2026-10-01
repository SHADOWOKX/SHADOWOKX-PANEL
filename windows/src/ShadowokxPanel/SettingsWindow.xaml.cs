using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using ShadowokxPanel.Core.Settings;
using ShadowokxPanel.Core.Codex;
using ShadowokxPanel.Platform;
using ShadowokxPanel.Services;
using Windows.Graphics;

namespace ShadowokxPanel;

public sealed partial class SettingsWindow : Window
{
    private static readonly string[] Companions = ["robot", "codex", "octopus", "penguin"];
    private readonly AppHost _host;
    private readonly AppWindow _appWindow;
    private bool _loading = true;
    private string _category = "General";

    public SettingsWindow(AppHost host)
    {
        _host = host;
        InitializeComponent();
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        _appWindow = AppWindow.GetFromWindowId(Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd));
        _appWindow.Title = "Shadowokx Panel Settings";
        _appWindow.Resize(new SizeInt32(680, 740));
        if (_appWindow.Presenter is OverlappedPresenter presenter) presenter.SetBorderAndTitleBar(false,false);
        SelectCategory("General");
        LoadValues(host.Settings.Current);
        RenderProviderSettings();
        ThemeService.Apply(Root, host.Settings.Current);
    }

    private void Category_Click(object sender, RoutedEventArgs args) => SelectCategory((string)((Button)sender).Tag);
    internal void SelectCategory(string name)
    {
        _category = name;
        var pages = new[] { GeneralPage, AccountsPage, AppearancePage, WeatherPage, AdvancedPage };
        var buttons = new[] { GeneralNav, AccountsNav, AppearanceNav, WeatherNav, AdvancedNav };
        var names = new[] { "General", "Accounts", "Appearance", "Weather", "Advanced" };
        for (var i=0;i<pages.Length;i++)
        {
            pages[i].Visibility=names[i]==name?Visibility.Visible:Visibility.Collapsed;
            buttons[i].Background=names[i]==name?new Microsoft.UI.Xaml.Media.SolidColorBrush(ThemeService.AccentColor(_host.Settings.Current)) { Opacity=.16 }:new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Transparent);
        }
        SettingsScroll.ChangeView(null,0,null,true);
    }
    private void Minimize_Click(object sender,RoutedEventArgs args) => ((OverlappedPresenter)_appWindow.Presenter).Minimize();
    private void Maximize_Click(object sender,RoutedEventArgs args)
    {
        var presenter=(OverlappedPresenter)_appWindow.Presenter;
        if (presenter.State==OverlappedPresenterState.Maximized) presenter.Restore();else presenter.Maximize();
    }
    private void Close_Click(object sender,RoutedEventArgs args) => Close();
    private void HeaderDrag_PointerPressed(object sender,Microsoft.UI.Xaml.Input.PointerRoutedEventArgs args)
    {
        if (!args.GetCurrentPoint(HeaderDrag).Properties.IsLeftButtonPressed) return;
        NativeMethods.ReleaseCapture();NativeMethods.SendMessage(WinRT.Interop.WindowNative.GetWindowHandle(this),0x00A1,2,0);
    }
    internal Microsoft.UI.Xaml.FrameworkElement PreviewRoot => Root;
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
        TrayCompanionToggle.IsOn = settings.ShowTrayCompanion;
        VaryWorkToggle.IsOn = settings.VaryWorkAnimations;
        CompanionCombo.SelectedIndex = Array.IndexOf(Companions, settings.Companion);
        CodexExecutableBox.Text = settings.CodexExecutablePath;
        CostEstimateToggle.IsOn = settings.ShowCostEstimate;
        EstimateModelCombo.ItemsSource = ApiPriceCatalog.Models.Select(p => p.Model).ToArray();
        EstimateModelCombo.SelectedItem = settings.EstimateModel;
        EstimateCachedBox.Value = settings.EstimateCachedPercent;
        EstimateOutputBox.Value = settings.EstimateOutputPercent;
        EstimateWriteBox.Value = settings.EstimateWritePercent;
        EstimateLongToggle.IsOn = settings.EstimateLongContext;
        UpdateEstimateInfo(settings);
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
            ? (AccentPreset)AccentCombo.SelectedIndex : AccentPreset.Orange;
        var cached = EstimateCachedBox.Value;
        var output = EstimateOutputBox.Value;
        var writes = EstimateWriteBox.Value;
        if (!double.IsFinite(cached) || !double.IsFinite(output) || !double.IsFinite(writes) ||
            cached < 0 || output < 0 || writes < 0 || cached + output + writes > 100)
        {
            EstimateInfo.Text = "Enter percentages whose total is at most 100%. Changes have not been saved.";
            return;
        }
        var next = _host.Settings.Current with
        {
            CodexExecutablePath = CodexExecutableBox.Text.Trim(),
            ShowCostEstimate = CostEstimateToggle.IsOn,
            EstimateModel = EstimateModelCombo.SelectedItem as string ?? "gpt-5.6-sol",
            EstimateCachedPercent = (int)cached,
            EstimateOutputPercent = (int)output,
            EstimateWritePercent = (int)writes,
            EstimateLongContext = EstimateLongToggle.IsOn,
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
            ShowTrayCompanion = TrayCompanionToggle.IsOn,
            VaryWorkAnimations = VaryWorkToggle.IsOn,
            Companion = Companions[Math.Clamp(CompanionCombo.SelectedIndex, 0, 3)],
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
            UpdateEstimateInfo(_host.Settings.Current);
            CustomAccentBox.IsEnabled = next.Accent == AccentPreset.Custom;
            ThemeService.Apply(Root, _host.Settings.Current);
            SelectCategory(_category);
        }
        catch (Exception error) when (error is UnauthorizedAccessException or IOException or
            ArgumentException or System.Security.SecurityException)
        {
            LoadValues(_host.Settings.Current);
        }
    }

    private void UpdateEstimateInfo(AppSettings settings)
    {
        var price = ApiPriceCatalog.Find(settings.EstimateModel)!;
        EstimateInfo.Text = $"Uncached input: {100 - settings.EstimateCachedPercent - settings.EstimateOutputPercent - settings.EstimateWritePercent}%. USD per 1M: input {price.Rate(settings.EstimateLongContext, 0)}, cache {price.Rate(settings.EstimateLongContext, 1)}, output {price.Rate(settings.EstimateLongContext, 2)}, writes {price.Rate(settings.EstimateLongContext, 3)}. Verified {ApiPriceCatalog.VerifiedDate}.";
        EstimateSourceLink.NavigateUri = new Uri(price.SourceUrl);
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
            Companion = defaults.Companion,
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

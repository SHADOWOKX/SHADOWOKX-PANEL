using Microsoft.UI.Dispatching;
using ShadowokxPanel.Core.History;
using ShadowokxPanel.Core.Models;
using ShadowokxPanel.Core.Settings;
using ShadowokxPanel.Services;

namespace ShadowokxPanel.ViewModels;

public sealed class DashboardViewModel : ObservableObject, IDisposable
{
    private readonly AppHost _host;
    private readonly DispatcherQueue _dispatcher;
    private CodexState _codex;
    private WeatherState _weather;
    private AppSettings _settings;
    private string _selectedPage;
    private bool _disposed;

    public DashboardViewModel(AppHost host, DispatcherQueue dispatcher)
    {
        _host = host;
        _dispatcher = dispatcher;
        _codex = host.Codex.State;
        _weather = host.Weather.State;
        _settings = host.Settings.Current;
        _selectedPage = _settings.RememberLastPage ? _settings.LastPage : "codex";
        if (!_settings.ShowWeather)
            _selectedPage = "codex";
        host.Codex.StateChanged += OnCodexChanged;
        host.Weather.StateChanged += OnWeatherChanged;
        host.Settings.Changed += OnSettingsChanged;
    }

    public CodexState Codex { get => _codex; private set => Set(ref _codex, value); }
    public WeatherState Weather { get => _weather; private set => Set(ref _weather, value); }
    public AppSettings Settings { get => _settings; private set => Set(ref _settings, value); }
    public string SelectedPage
    {
        get => _selectedPage;
        private set => Set(ref _selectedPage, value);
    }

    public UsagePace UsagePace => UsageAnalytics.GetPace(Codex.TokenUsage, DateTimeOffset.Now);

    public async Task SelectPageAsync(string page)
    {
        if (page == "weather" && !Settings.ShowWeather)
            page = "codex";
        SelectedPage = page == "weather" ? "weather" : "codex";
        if (Settings.RememberLastPage && Settings.LastPage != SelectedPage)
            await _host.Settings.SaveAsync(Settings with { LastPage = SelectedPage });
    }

    public Task RefreshCodexAsync() => _host.Codex.RefreshAsync(true);
    public Task RefreshWeatherAsync() => _host.Weather.RefreshAsync(true);
    public Task RefreshAllAsync(bool force = true) => _host.RefreshAllAsync(force);

    private void OnCodexChanged(object? sender, CodexState state) =>
        Enqueue(() =>
        {
            Codex = state;
            Raise(nameof(UsagePace));
        });

    private void OnWeatherChanged(object? sender, WeatherState state) =>
        Enqueue(() => Weather = state);

    private void OnSettingsChanged(object? sender, AppSettings settings) =>
        Enqueue(() =>
        {
            Settings = settings;
            if (!settings.ShowWeather && SelectedPage == "weather")
                SelectedPage = "codex";
        });

    private void Enqueue(Action action)
    {
        if (_dispatcher.HasThreadAccess)
            action();
        else
            _dispatcher.TryEnqueue(() => action());
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _host.Codex.StateChanged -= OnCodexChanged;
        _host.Weather.StateChanged -= OnWeatherChanged;
        _host.Settings.Changed -= OnSettingsChanged;
    }
}

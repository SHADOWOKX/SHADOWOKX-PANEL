using ShadowokxPanel.Core.Codex;
using ShadowokxPanel.Core.Settings;
using ShadowokxPanel.Core.Storage;
using ShadowokxPanel.Core.Weather;

namespace ShadowokxPanel.Services;

public sealed class AppHost : IAsyncDisposable
{
    private readonly SemaphoreSlim _lifecycle = new(1, 1);
    private bool _started;
    private AppSettings _appliedSettings = new();

    public AppHost()
    {
        Paths = new ApplicationPaths();
        Settings = new SettingsStore(Paths);
    }

    public ApplicationPaths Paths { get; }
    public SettingsStore Settings { get; }
    public CodexProvider Codex { get; private set; } = null!;
    public WeatherProvider Weather { get; private set; } = null!;

    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        await _lifecycle.WaitAsync(cancellationToken);
        try
        {
            if (_started)
                return;
            var settings = await Settings.LoadAsync(cancellationToken);
            var logger = new RedactingLogger(Paths, () => Settings.Current.DebugLogging);
            Codex = new CodexProvider(
                Paths, settings.CodexRefreshMinutes, logger: logger);
            Weather = new WeatherProvider(
                Paths,
                settings.WeatherLocation,
                settings.TemperatureUnit,
                settings.WeatherRefreshMinutes,
                settings.ShowWeather,
                logger: logger);
            Settings.Changed += OnSettingsChanged;
            _appliedSettings = settings;
            _started = true;
        }
        finally
        {
            _lifecycle.Release();
        }

        await Task.WhenAll(
            Codex.StartAsync(cancellationToken),
            Weather.StartAsync(cancellationToken));
    }

    public Task RefreshAllAsync(bool force = true, CancellationToken cancellationToken = default) =>
        Task.WhenAll(
            Codex.RefreshAsync(force, cancellationToken),
            Settings.Current.ShowWeather
                ? Weather.RefreshAsync(force, cancellationToken)
                : Task.FromResult(Weather.State));

    public Task ResumeAsync(CancellationToken cancellationToken = default) =>
        RefreshAllAsync(false, cancellationToken);

    public async Task ClearHistoryAsync(CancellationToken cancellationToken = default)
    {
        await Codex.ClearHistoryAsync(cancellationToken);
    }

    private void OnSettingsChanged(object? sender, AppSettings settings)
    {
        Codex.UpdateInterval(settings.CodexRefreshMinutes);
        var wasEnabled = _appliedSettings.ShowWeather;
        var weatherConfigurationChanged =
            settings.WeatherLocation != _appliedSettings.WeatherLocation ||
            settings.TemperatureUnit != _appliedSettings.TemperatureUnit ||
            settings.WeatherRefreshMinutes != _appliedSettings.WeatherRefreshMinutes;
        Weather.SetEnabled(settings.ShowWeather);
        _appliedSettings = settings;
        if (settings.ShowWeather && (weatherConfigurationChanged || !wasEnabled))
        {
            _ = Weather.UpdateAsync(
                settings.WeatherLocation,
                settings.TemperatureUnit,
                settings.WeatherRefreshMinutes);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (!_started)
            return;
        Settings.Changed -= OnSettingsChanged;
        await Task.WhenAll(Codex.DisposeAsync().AsTask(), Weather.DisposeAsync().AsTask());
        _lifecycle.Dispose();
        _started = false;
    }
}

using ShadowokxPanel.Core.Codex;
using ShadowokxPanel.Core.Settings;
using ShadowokxPanel.Core.Storage;
using ShadowokxPanel.Core.Weather;

namespace ShadowokxPanel.Services;

public sealed class AppHost : IAsyncDisposable
{
    private readonly SemaphoreSlim _lifecycle = new(1, 1);
    private readonly object _disposeSync = new();
    private CodexProvider? _codex;
    private WeatherProvider? _weather;
    private Task? _disposeTask;
    private bool _started;
    private bool _disposed;
    private bool _settingsSubscribed;
    private AppSettings _appliedSettings = new();

    public AppHost()
    {
        Paths = new ApplicationPaths();
        Settings = new SettingsStore(Paths);
    }

    public ApplicationPaths Paths { get; }
    public SettingsStore Settings { get; }
    public CodexProvider Codex => _codex ??
        throw new InvalidOperationException("The application host has not started.");
    public WeatherProvider Weather => _weather ??
        throw new InvalidOperationException("The application host has not started.");

    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        await _lifecycle.WaitAsync(cancellationToken);
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_started)
                return;
            var settings = await Settings.LoadAsync(cancellationToken);
            var logger = new RedactingLogger(Paths, () => Settings.Current.DebugLogging);
            _codex = new CodexProvider(
                Paths, settings.CodexRefreshMinutes, logger: logger);
            _weather = new WeatherProvider(
                Paths,
                settings.WeatherLocation,
                settings.TemperatureUnit,
                settings.WeatherRefreshMinutes,
                settings.ShowWeather,
                logger: logger);
            Settings.Changed += OnSettingsChanged;
            _settingsSubscribed = true;
            _appliedSettings = settings;
            await Task.WhenAll(
                _codex.StartAsync(cancellationToken),
                _weather.StartAsync(cancellationToken));
            _started = true;
        }
        finally
        {
            _lifecycle.Release();
        }
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

    public ValueTask DisposeAsync()
    {
        lock (_disposeSync)
            return new ValueTask(_disposeTask ??= DisposeCoreAsync());
    }

    private async Task DisposeCoreAsync()
    {
        CodexProvider? codex;
        WeatherProvider? weather;
        await _lifecycle.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_disposed)
                return;
            _disposed = true;
            if (_settingsSubscribed)
            {
                Settings.Changed -= OnSettingsChanged;
                _settingsSubscribed = false;
            }
            codex = _codex;
            weather = _weather;
            _codex = null;
            _weather = null;
            _started = false;
        }
        finally
        {
            _lifecycle.Release();
        }

        var disposals = new List<Task>(2);
        if (codex is not null)
            disposals.Add(codex.DisposeAsync().AsTask());
        if (weather is not null)
            disposals.Add(weather.DisposeAsync().AsTask());
        try
        {
            await Task.WhenAll(disposals).ConfigureAwait(false);
        }
        finally
        {
            _lifecycle.Dispose();
        }
    }
}

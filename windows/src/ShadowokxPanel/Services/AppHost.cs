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
    private Core.AI.CommandCodeTaskMonitor? _commandCodeTasks;
    private Core.AI.CommandCodeProcessMonitor? _commandCodeProcesses;
    private readonly Core.Codex.CompanionActivityReader _codexActivity = new();
    private CancellationTokenSource? _commandCodeStop;
    private bool _commandCodeOpen;
    private bool _codexBusy;
    private Task? _disposeTask;
    private bool _started;
    private bool _initialized;
    private bool _disposed;
    private bool _settingsSubscribed;
    private AppSettings _appliedSettings = new();

    public AppHost(string? dataRoot = null)
    {
        Paths = new ApplicationPaths(dataRoot);
        Settings = new SettingsStore(Paths);
    }

    public Core.AI.AIProviderService AI { get; private set; } = null!;
    public ApplicationPaths Paths { get; }
    public SettingsStore Settings { get; }
    public bool ProvidersReady { get; private set; }
    // Real in-flight Command Code turn (from the desktop app's own log). Drives the
    // mascot. Application presence is tracked separately and never animates.
    public bool CommandCodeBusy => _commandCodeTasks?.Current.Busy ?? false;
    public bool CommandCodeOpen => _commandCodeOpen;
    public string? CommandCodeLogPath => _commandCodeTasks?.LogPath;
    // Always-on Codex task state so the taskbar companion can animate while the panel
    // is closed. Reuses the existing CompanionActivityReader; it is not a new detector.
    public bool CodexBusy => _codexBusy;
    public CodexProvider Codex => _codex ??
        throw new InvalidOperationException("The application host has not started.");
    public WeatherProvider Weather => _weather ??
        throw new InvalidOperationException("The application host has not started.");

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        await _lifecycle.WaitAsync(cancellationToken);
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_initialized)
                return;
            var settings = await Settings.LoadAsync(cancellationToken);
            AI = new Core.AI.AIProviderService(Paths, Settings);
            var logger = new RedactingLogger(Paths, () => Settings.Current.DebugLogging);
            _codex = new CodexProvider(
                Paths, settings.CodexRefreshMinutes,
                discover: () => CodexDiscovery.Find(explicitExecutable: Settings.Current.CodexExecutablePath), logger: logger,
                discoverAlternative: excluded => CodexDiscovery.Find(
                    explicitExecutable: Settings.Current.CodexExecutablePath, excludedExecutables: excluded));
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
            _initialized = true;
        }
        finally
        {
            _lifecycle.Release();
        }
    }

    public async Task StartProvidersAsync(CancellationToken cancellationToken = default)
    {
        await _lifecycle.WaitAsync(cancellationToken);
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_started)
                return;
            if (!_initialized || _codex is null || _weather is null)
                throw new InvalidOperationException("The application host has not been initialized.");
            _started = true;
            AI.Start();
            _commandCodeTasks = new Core.AI.CommandCodeTaskMonitor();
            _commandCodeProcesses = new Core.AI.CommandCodeProcessMonitor();
            _commandCodeStop = new CancellationTokenSource();
            _ = ObserveCommandCodeAsync(_commandCodeStop.Token);
            try
            {
                await Task.WhenAll(
                    Codex.StartAsync(cancellationToken),
                    Weather.StartAsync(cancellationToken));
                ProvidersReady = true;
            }
            catch
            {
                _started = false;
                throw;
            }
        }
        finally
        {
            _lifecycle.Release();
        }
    }

    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken);
        await StartProvidersAsync(cancellationToken);
    }

    public Task RefreshAllAsync(bool force = true, CancellationToken cancellationToken = default) =>
        Task.WhenAll(
            AI.RefreshAsync(),
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

    // One observer for the whole session: application presence (evidence-based,
    // never animates) plus the desktop app's own turn lifecycle (animates while a
    // real command is running). The single timer is stopped in DisposeAsync.
    private async Task ObserveCommandCodeAsync(CancellationToken cancellationToken)
    {
        try
        {
            var iteration = 0;
            while (!cancellationToken.IsCancellationRequested)
            {
                // Application presence changes slowly (3-second cadence, matching the
                // Linux observer); the turn log is polled every second.
                if (iteration % 3 == 0 && _commandCodeProcesses is not null)
                {
                    var presence = _commandCodeProcesses.Sample();
                    _commandCodeOpen = presence.Open;
                    _commandCodeTasks?.SetApplicationOpen(presence.Open);
                }
                // Codex task state for the taskbar companion (2-second cadence).
                if (iteration % 2 == 0)
                {
                    try
                    {
                        var activity = await _codexActivity.ReadAsync().ConfigureAwait(false);
                        _codexBusy = activity.Active;
                    }
                    catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                    {
                        _codexBusy = false;
                    }
                }
                if (_commandCodeTasks is not null)
                    await _commandCodeTasks.RefreshAsync().ConfigureAwait(false);
                iteration++;
                await Task.Delay(TimeSpan.FromSeconds(Core.AI.CommandCodeTaskMonitor.PollSeconds), cancellationToken)
                    .ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) { }
    }

    private void OnSettingsChanged(object? sender, AppSettings settings)
    {
        if (settings.CodexExecutablePath != _appliedSettings.CodexExecutablePath)
        {
            Codex.InvalidateDiscovery();
            _ = Codex.RefreshAsync(true);
        }
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
            _commandCodeStop?.Cancel();
            _commandCodeTasks?.Dispose();
            _commandCodeTasks = null;
            _commandCodeProcesses = null;
            AI?.Dispose();
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
            _initialized = false;
            ProvidersReady = false;
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

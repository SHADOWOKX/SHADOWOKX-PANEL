using System.Threading.Channels;
using ShadowokxPanel.Core.Models;
using ShadowokxPanel.Core.Storage;

namespace ShadowokxPanel.Core.Weather;

public sealed class WeatherProvider : IAsyncDisposable
{
    private readonly IWeatherClient _client;
    private readonly JsonFileStore<WeatherCache> _cache;
    private readonly RedactingLogger? _logger;
    private readonly Channel<bool> _scheduleChanges = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
    { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });
    private bool _started;
    private readonly object _sync = new();
    private readonly CancellationTokenSource _lifetime = new();
    private CancellationTokenSource _configuration = new();
    private Task<WeatherState>? _refreshTask;
    private Task? _timerTask;
    private int _refreshMinutes;
    private string _query;
    private string _unit;
    private bool _enabled;

    public WeatherProvider(
        ApplicationPaths paths,
        string query,
        string unit,
        int refreshMinutes,
        bool enabled = true,
        IWeatherClient? client = null,
        RedactingLogger? logger = null)
    {
        _query = WeatherNormalizer.NormalizeQuery(query);
        _unit = unit == "fahrenheit" ? "fahrenheit" : "celsius";
        _refreshMinutes = Math.Clamp(refreshMinutes, 15, 180);
        _enabled = enabled;
        _client = client ?? new OpenMeteoClient();
        _cache = new JsonFileStore<WeatherCache>(paths.WeatherCacheFile);
        _logger = logger;
    }

    public WeatherState State { get; private set; } = new();
    public event EventHandler<WeatherState>? StateChanged;

    public async Task<WeatherState> StartAsync(CancellationToken cancellationToken = default)
    {
        lock (_sync)
        {
            if (_started || _lifetime.IsCancellationRequested) return State;
            _started = true;
        }
        var cached = await _cache.ReadAsync(cancellationToken).ConfigureAwait(false);
        var now = DateTimeOffset.Now;
        if (cached is not null && cached.ResolvedLocation.Query == _query &&
            cached.State.Unit == _unit && cached.State.HasData &&
            cached.State.LastSuccessfulRefresh is { } refreshed && refreshed <= now.AddMinutes(5))
        {
            Publish(cached.State with
            {
                Status = now - refreshed >= TimeSpan.FromMinutes(_refreshMinutes)
                    ? ProviderStatus.Stale : ProviderStatus.Cached,
            });
        }
        _timerTask = RunTimerAsync(_lifetime.Token);
        if (_enabled)
            _ = RefreshAsync(false, cancellationToken);
        return State;
    }

    public Task<WeatherState> RefreshAsync(
        bool force = true,
        CancellationToken cancellationToken = default)
    {
        lock (_sync)
        {
            if (!_enabled || _lifetime.IsCancellationRequested) return Task.FromResult(State);
            if (_refreshTask is not null)
                return _refreshTask;
            if (!force && !IsStale())
                return Task.FromResult(State);
            var query = _query;
            var unit = _unit;
            var configuration = _configuration.Token;
            var task = Task.Run(() => RefreshCoreAsync(query, unit, configuration, cancellationToken));
            _refreshTask = task;
            _ = task.ContinueWith(
                _ =>
                {
                    lock (_sync)
                    {
                        if (ReferenceEquals(_refreshTask, task))
                            _refreshTask = null;
                    }
                },
                CancellationToken.None,
                TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default);
            return task;
        }
    }

    public async Task UpdateAsync(
        string query,
        string unit,
        int refreshMinutes,
        CancellationToken cancellationToken = default)
    {
        _query = WeatherNormalizer.NormalizeQuery(query);
        _unit = unit == "fahrenheit" ? "fahrenheit" : "celsius";
        _refreshMinutes = Math.Clamp(refreshMinutes, 15, 180);
        Task<WeatherState>? pending;
        lock (_sync)
        {
            _configuration.Cancel();
            _configuration.Dispose();
            _configuration = new CancellationTokenSource();
            pending = _refreshTask;
        }
        if (pending is not null)
            await pending.ConfigureAwait(false);
        _scheduleChanges.Writer.TryWrite(true);
        if (_enabled)
            await RefreshAsync(true, cancellationToken).ConfigureAwait(false);
    }

    public void SetEnabled(bool enabled)
    {
        lock (_sync)
        {
            if (_enabled == enabled)
                return;
            _enabled = enabled;
            if (!enabled)
                _configuration.Cancel();
            else if (_configuration.IsCancellationRequested)
            {
                _configuration.Dispose();
                _configuration = new CancellationTokenSource();
            }
        }
        _scheduleChanges.Writer.TryWrite(true);
    }

    private bool IsStale() => State.LastSuccessfulRefresh is not { } refreshed ||
        State.Status is ProviderStatus.Error or ProviderStatus.Stale ||
        DateTimeOffset.Now - refreshed >= TimeSpan.FromMinutes(_refreshMinutes);

    private async Task<WeatherState> RefreshCoreAsync(
        string query,
        string unit,
        CancellationToken configurationToken,
        CancellationToken externalCancellation)
    {
        var previous = State;
        Publish(previous with
        {
            Status = previous.HasData ? ProviderStatus.Refreshing : ProviderStatus.Loading,
            ErrorMessage = null,
        });
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(
            externalCancellation, _lifetime.Token, configurationToken);
        try
        {
            var result = await _client.ReadAsync(query, unit, linked.Token).ConfigureAwait(false);
            if (configurationToken.IsCancellationRequested || query != _query || unit != _unit)
                return State;
            try
            {
                await _cache.WriteAsync(
                    new WeatherCache(result.State, result.Location), linked.Token).ConfigureAwait(false);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                await LogAsync("weather.cache.write.failed").ConfigureAwait(false);
            }
            Publish(result.State);
            return result.State;
        }
        catch (OperationCanceledException) when (
            _lifetime.IsCancellationRequested || externalCancellation.IsCancellationRequested ||
            configurationToken.IsCancellationRequested)
        {
            return State;
        }
        catch (Exception error)
        {
            var message = error is WeatherProviderException
                ? error.Message
                : "Weather is temporarily unavailable. Check the connection and try again.";
            var state = previous with
            {
                Status = previous.HasData ? ProviderStatus.Stale : ProviderStatus.Error,
                ErrorMessage = message,
            };
            Publish(state);
            await LogAsync("weather.refresh.failed", new { error = error.GetType().Name })
                .ConfigureAwait(false);
            return state;
        }
    }

    private async Task RunTimerAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                using var iteration = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                var delay = Task.Delay(_enabled ? TimeSpan.FromMinutes(_refreshMinutes) :
                    Timeout.InfiniteTimeSpan, iteration.Token);
                var changed = _scheduleChanges.Reader.WaitToReadAsync(iteration.Token).AsTask();
                var completed = await Task.WhenAny(delay, changed).ConfigureAwait(false);
                iteration.Cancel();
                try { await Task.WhenAll(delay, changed).ConfigureAwait(false); }
                catch (OperationCanceledException) { }
                if (completed == changed)
                {
                    while (_scheduleChanges.Reader.TryRead(out _)) { }
                    continue;
                }
                if (_enabled) await RefreshAsync(false, cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
    }

    private void Publish(WeatherState state)
    {
        State = state;
        StateChanged?.Invoke(this, state);
    }

    private Task LogAsync(string eventName, object? details = null) =>
        _logger?.DebugAsync(eventName, details) ?? Task.CompletedTask;

    public async ValueTask DisposeAsync()
    {
        _lifetime.Cancel();
        _configuration.Cancel();
        if (_timerTask is not null)
        {
            try { await _timerTask.ConfigureAwait(false); }
            catch (OperationCanceledException) { }
        }
        Task<WeatherState>? refresh;
        lock (_sync)
            refresh = _refreshTask;
        if (refresh is not null)
            await refresh.ConfigureAwait(false);
        _lifetime.Dispose();
        _configuration.Dispose();
        if (_client is IDisposable disposable)
            disposable.Dispose();
    }
}

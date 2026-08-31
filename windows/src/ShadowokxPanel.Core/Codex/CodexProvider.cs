using System.Text.Json;
using ShadowokxPanel.Core.History;
using ShadowokxPanel.Core.Models;
using ShadowokxPanel.Core.Storage;

namespace ShadowokxPanel.Core.Codex;

public sealed class CodexProvider : IAsyncDisposable
{
    private readonly Func<CodexLaunchSpec?> _discover;
    private readonly ICodexProtocolClient _client;
    private readonly TokenHistoryStore _historyStore;
    private readonly JsonFileStore<CodexState> _cache;
    private readonly RedactingLogger? _logger;
    private readonly object _sync = new();
    private CancellationTokenSource _lifetime = new();
    private Task<CodexState>? _refreshTask;
    private Task? _timerTask;
    private TokenHistoryDocument _history = TokenHistoryDocument.Empty(DateTimeOffset.Now);
    private int _refreshMinutes;

    public CodexProvider(
        ApplicationPaths paths,
        int refreshMinutes,
        Func<CodexLaunchSpec?>? discover = null,
        ICodexProtocolClient? client = null,
        RedactingLogger? logger = null)
    {
        _refreshMinutes = Math.Clamp(refreshMinutes, 5, 120);
        _discover = discover ?? (() => CodexDiscovery.Find());
        _client = client ?? new CodexProtocolClient();
        _historyStore = new TokenHistoryStore(paths);
        _cache = new JsonFileStore<CodexState>(paths.CodexCacheFile);
        _logger = logger;
    }

    public CodexState State { get; private set; } = new();
    public event EventHandler<CodexState>? StateChanged;

    public async Task<CodexState> StartAsync(CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.Now;
        var cacheTask = _cache.ReadAsync(cancellationToken);
        var historyTask = _historyStore.LoadAsync(now, cancellationToken);
        await Task.WhenAll(cacheTask, historyTask).ConfigureAwait(false);
        _history = historyTask.Result;
        var cached = cacheTask.Result;
        if (cached?.HasData == true && cached.LastSuccessfulRefresh is { } refreshed &&
            refreshed <= now.AddMinutes(5))
        {
            var stale = now - refreshed >= TimeSpan.FromMinutes(_refreshMinutes);
            Publish(cached with
            {
                Status = stale ? ProviderStatus.Stale : ProviderStatus.Cached,
                TokenUsage = TokenHistoryStore.Apply(cached.TokenUsage, _history, now),
            });
        }
        _timerTask = RunTimerAsync(_lifetime.Token);
        _ = RefreshAsync(false, cancellationToken);
        return State;
    }

    public Task<CodexState> RefreshAsync(
        bool force = true,
        CancellationToken cancellationToken = default)
    {
        lock (_sync)
        {
            if (_refreshTask is not null)
                return _refreshTask;
            if (!force && !IsStale())
                return Task.FromResult(State);
            var task = RefreshCoreAsync(cancellationToken);
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

    public void UpdateInterval(int minutes) => _refreshMinutes = Math.Clamp(minutes, 5, 120);

    public async Task ClearHistoryAsync(CancellationToken cancellationToken = default)
    {
        Task<CodexState>? pending;
        lock (_sync)
            pending = _refreshTask;
        if (pending is not null)
            await pending.ConfigureAwait(false);
        await _historyStore.ClearAsync(cancellationToken).ConfigureAwait(false);
        _history = TokenHistoryDocument.Empty(DateTimeOffset.Now);
        Publish(State with
        {
            TokenUsage = TokenHistoryStore.Apply(State.TokenUsage, _history, DateTimeOffset.Now),
        });
        await RefreshAsync(true, cancellationToken).ConfigureAwait(false);
    }

    private bool IsStale() => State.LastSuccessfulRefresh is not { } refreshed ||
        State.Status is ProviderStatus.Error or ProviderStatus.Stale ||
        DateTimeOffset.Now - refreshed >= TimeSpan.FromMinutes(_refreshMinutes);

    private async Task<CodexState> RefreshCoreAsync(CancellationToken externalCancellation)
    {
        var previous = State;
        Publish(previous with
        {
            Status = previous.HasData ? ProviderStatus.Refreshing : ProviderStatus.Loading,
            ErrorCode = null,
            ErrorMessage = null,
        });
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(
            externalCancellation, _lifetime.Token);
        try
        {
            var launch = _discover() ?? throw new CodexProviderException(
                "not-installed", "Install Codex for this user, then sign in and retry.");
            var response = await _client.ReadAsync(launch, linked.Token).ConfigureAwait(false);
            var now = DateTimeOffset.Now;
            CodexState live;
            try { live = CodexNormalizer.Normalize(response.RateLimits, response.Usage, now); }
            catch (Exception error) when (error is JsonException or InvalidDataException or ArgumentException)
            {
                throw new CodexProviderException(
                    "unsupported-response",
                    "This Codex version did not return supported usage data.", error);
            }
            try
            {
                _history = await _historyStore.MergeAsync(_history, live.TokenUsage, now, linked.Token)
                    .ConfigureAwait(false);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                await LogAsync("codex.history.write.failed").ConfigureAwait(false);
            }
            var state = live with { TokenUsage = TokenHistoryStore.Apply(live.TokenUsage, _history, now) };
            try
            {
                await _cache.WriteAsync(state with
                {
                    TokenUsage = TokenHistoryStore.WithoutHistory(state.TokenUsage),
                }, linked.Token).ConfigureAwait(false);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                await LogAsync("codex.cache.write.failed").ConfigureAwait(false);
            }
            Publish(state);
            return state;
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested || externalCancellation.IsCancellationRequested)
        {
            return State;
        }
        catch (Exception error)
        {
            var (code, message) = error switch
            {
                CodexProviderException known => (known.Code, known.Message),
                TimeoutException => ("timeout", "Codex did not respond in time."),
                InvalidDataException => ("usage-unavailable", "Open Codex and confirm you are signed in, then retry."),
                _ => ("unavailable", "Codex usage is temporarily unavailable."),
            };
            var state = previous with
            {
                Status = previous.HasData ? ProviderStatus.Stale : ProviderStatus.Error,
                ErrorCode = code,
                ErrorMessage = message,
            };
            Publish(state);
            await LogAsync("codex.refresh.failed", new { error = error.GetType().Name, code })
                .ConfigureAwait(false);
            return state;
        }
    }

    private async Task RunTimerAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
            {
                if (IsStale())
                    await RefreshAsync(false, cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
    }

    private void Publish(CodexState state)
    {
        State = state;
        StateChanged?.Invoke(this, state);
    }

    private Task LogAsync(string eventName, object? details = null) =>
        _logger?.DebugAsync(eventName, details) ?? Task.CompletedTask;

    public async ValueTask DisposeAsync()
    {
        _lifetime.Cancel();
        if (_timerTask is not null)
        {
            try { await _timerTask.ConfigureAwait(false); }
            catch (OperationCanceledException) { }
        }
        Task<CodexState>? refresh;
        lock (_sync)
            refresh = _refreshTask;
        if (refresh is not null)
            await refresh.ConfigureAwait(false);
        _lifetime.Dispose();
    }

    private sealed class CodexProviderException(string code, string message, Exception? inner = null)
        : Exception(message, inner)
    {
        public string Code { get; } = code;
    }
}

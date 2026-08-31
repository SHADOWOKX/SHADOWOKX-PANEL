using System.Text.Json;
using ShadowokxPanel.Core.Codex;
using ShadowokxPanel.Core.Models;
using ShadowokxPanel.Core.Weather;

namespace ShadowokxPanel.Core.Tests;

public sealed class ProviderTests
{
    [Fact]
    public async Task AuthenticatedCodexProducesCurrentUserState()
    {
        using var temporary = TemporaryDirectory.Create();
        await using var provider = new CodexProvider(
            temporary.Paths,
            15,
            () => new CodexLaunchSpec(@"C:\Tools\codex.exe", false),
            new FakeCodexClient(success: true));
        await provider.StartAsync();
        await WaitForAsync(() => provider.State.Status != ProviderStatus.Loading);
        var state = provider.State;
        Assert.Equal(ProviderStatus.Success, state.Status);
        Assert.Equal(89, state.Weekly?.RemainingPercent);
        Assert.Single(state.TokenUsage?.DailyBuckets ?? []);
    }

    [Fact]
    public async Task MissingCodexProducesNotDetectedState()
    {
        using var temporary = TemporaryDirectory.Create();
        await using var provider = new CodexProvider(
            temporary.Paths, 15, () => null, new FakeCodexClient(true));
        await provider.StartAsync();
        await WaitForAsync(() => provider.State.Status != ProviderStatus.Loading);
        var state = provider.State;
        Assert.Equal(ProviderStatus.Error, state.Status);
        Assert.Equal("not-installed", state.ErrorCode);
    }

    [Fact]
    public async Task UnavailableCodexDoesNotThrowOrExposeProtocolDetails()
    {
        using var temporary = TemporaryDirectory.Create();
        await using var provider = new CodexProvider(
            temporary.Paths,
            15,
            () => new CodexLaunchSpec(@"C:\Tools\codex.exe", false),
            new FakeCodexClient(success: false));
        await provider.StartAsync();
        await WaitForAsync(() => provider.State.Status != ProviderStatus.Loading);
        var state = provider.State;
        Assert.Equal(ProviderStatus.Error, state.Status);
        Assert.Equal("usage-unavailable", state.ErrorCode);
        Assert.Contains("sign", state.ErrorMessage, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task WeatherFailureRetainsCachedDataAsStale()
    {
        using var temporary = TemporaryDirectory.Create();
        var client = new SequencedWeatherClient();
        await using var provider = new WeatherProvider(
            temporary.Paths, "Cairo, Egypt", "celsius", 30, client: client);
        await provider.StartAsync();
        await WaitForAsync(() => provider.State.Status == ProviderStatus.Success);
        await provider.RefreshAsync(false);
        var first = provider.State;
        Assert.Equal(ProviderStatus.Success, first.Status);
        var second = await provider.RefreshAsync(true);
        Assert.Equal(ProviderStatus.Stale, second.Status);
        Assert.True(second.HasData);
    }

    [Fact]
    public async Task DisabledWeatherStopsRequestsAndCanBeEnabledAgain()
    {
        using var temporary = TemporaryDirectory.Create();
        var client = new CountingWeatherClient();
        await using var provider = new WeatherProvider(
            temporary.Paths, "Cairo, Egypt", "celsius", 30, enabled: false, client: client);
        await provider.StartAsync();
        Assert.Equal(0, client.Count);

        provider.SetEnabled(true);
        await provider.UpdateAsync("Cairo, Egypt", "celsius", 30);
        Assert.Equal(1, client.Count);

        provider.SetEnabled(false);
        await Task.Delay(20);
        Assert.Equal(1, client.Count);
    }

    private static async Task WaitForAsync(Func<bool> condition)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        while (!condition())
            await Task.Delay(10, timeout.Token);
    }

    private sealed class FakeCodexClient(bool success) : ICodexProtocolClient
    {
        public Task<CodexProtocolResponse> ReadAsync(
            CodexLaunchSpec launch,
            CancellationToken cancellationToken = default)
        {
            if (!success)
                throw new InvalidDataException("account unavailable: do not expose this detail");
            using var limits = JsonDocument.Parse("""
            { "rateLimits": { "primary": {
              "usedPercent": 11, "windowDurationMins": 10080, "resetsAt": 2000000000
            } } }
            """);
            using var usage = JsonDocument.Parse($$"""
            { "summary": { "lifetimeTokens": 5000 }, "dailyUsageBuckets": [
              { "startDate": "{{DateOnly.FromDateTime(DateTime.Now):yyyy-MM-dd}}", "tokens": 200 }
            ] }
            """);
            return Task.FromResult(new CodexProtocolResponse(
                limits.RootElement.Clone(), usage.RootElement.Clone()));
        }
    }

    private sealed class SequencedWeatherClient : IWeatherClient
    {
        private int _count;
        public Task<(WeatherState State, ResolvedLocation Location)> ReadAsync(
            string query,
            string unit,
            CancellationToken cancellationToken = default)
        {
            if (Interlocked.Increment(ref _count) > 1)
                throw new HttpRequestException("offline");
            var location = new ResolvedLocation(query, 30, 31, "Cairo, Egypt");
            var state = new WeatherState
            {
                Status = ProviderStatus.Success,
                Location = location.DisplayName,
                Unit = unit,
                Current = new WeatherCurrent(29, 30, 45, 10, 0,
                    new WeatherCondition("Clear sky", "sun")),
                Today = new WeatherToday(33, 22, 6, DateTimeOffset.Now, DateTimeOffset.Now),
                LastSuccessfulRefresh = DateTimeOffset.Now,
            };
            return Task.FromResult((state, location));
        }
    }

    private sealed class CountingWeatherClient : IWeatherClient
    {
        private int _count;
        public int Count => Volatile.Read(ref _count);

        public Task<(WeatherState State, ResolvedLocation Location)> ReadAsync(
            string query,
            string unit,
            CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _count);
            var location = new ResolvedLocation(query, 30, 31, "Cairo, Egypt");
            var state = new WeatherState
            {
                Status = ProviderStatus.Success,
                Location = location.DisplayName,
                Unit = unit,
                Current = new WeatherCurrent(29, 30, 45, 10, 0,
                    new WeatherCondition("Clear sky", "sun")),
                Today = new WeatherToday(31, 22, 4, null, null),
                LastSuccessfulRefresh = DateTimeOffset.Now,
            };
            return Task.FromResult((state, location));
        }
    }
}

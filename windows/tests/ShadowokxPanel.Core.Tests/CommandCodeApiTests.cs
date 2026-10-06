using System.Text;
using System.Text.Json;
using ShadowokxPanel.Core.AI;

namespace ShadowokxPanel.Core.Tests;

public sealed class CommandCodeApiTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.FromUnixTimeSeconds(1_000_000);
    private const string Key = "abcdefgh";

    private static byte[] Body(string text) => Encoding.UTF8.GetBytes(text);

    private static string Credits(string? planId = "individual-goat")
    {
        var plan = planId is null ? "null" : JsonSerializer.Serialize(planId);
        return "{\"credits\":{\"planId\":" + plan +
            "},\"windowLimits\":{\"weekly\":{\"used\":5,\"cap\":35}}}";
    }

    private static CommandCodeRouteResponse Route(string path)
    {
        if (path.StartsWith("/alpha/whoami", StringComparison.Ordinal))
            return new(200, null, Body("""{"data":{"user":{"userName":"tester"}}}"""));
        if (path.StartsWith("/alpha/billing/credits", StringComparison.Ordinal))
            return new(200, null, Body(Credits()));
        if (path.StartsWith("/alpha/billing/subscriptions", StringComparison.Ordinal))
            return new(200, null, Body("""{"data":{"planId":"individual-goat","status":"active"}}"""));
        return new(200, null, Body("""{"totalCount":12,"totalCredits":40}"""));
    }

    [Fact]
    public async Task ReadsMandatoryThenOptionalRoutesInOrder()
    {
        var seen = new List<string>();
        using var api = new CommandCodeApi(transport: (path, _, _) =>
        {
            seen.Add(path.Split('?', 2)[0]);
            return Task.FromResult(Route(path));
        }, clock: () => Now);
        var usage = await api.FetchAsync(Key);
        Assert.Equal(["/alpha/whoami", "/alpha/billing/credits", "/alpha/billing/subscriptions", "/alpha/usage/summary"], seen);
        Assert.Equal("GOAT", usage.Plan);
        Assert.Single(usage.Windows);
    }

    [Fact]
    public async Task AuthenticationFailureStopsAndMarks()
    {
        using var api = new CommandCodeApi(transport: (_, _, _) => Task.FromResult(new CommandCodeRouteResponse(401, null, null)),
            clock: () => Now);
        var error = await Assert.ThrowsAsync<CommandCodeException>(() => api.FetchAsync(Key));
        Assert.Equal("authentication-failed", error.Code);
    }

    [Fact]
    public async Task RateLimitHonoursRetryAfterAndStopsFurtherRequests()
    {
        var calls = 0;
        var api = new CommandCodeApi(transport: (path, _, _) =>
        {
            calls++;
            return Task.FromResult(path.StartsWith("/alpha/whoami", StringComparison.Ordinal)
                ? new CommandCodeRouteResponse(200, null, Body("""{"user":{"userName":"t"}}"""))
                : new CommandCodeRouteResponse(429, "60", null));
        }, clock: () => Now);
        using (api)
        {
            var error = await Assert.ThrowsAsync<CommandCodeException>(() => api.FetchAsync(Key));
            Assert.Equal("rate-limited", error.Code);
            Assert.Equal(Now.AddSeconds(60), error.RetryAt);
            Assert.Equal(2, calls);
            // While the retry deadline holds, no further request is issued.
            await Assert.ThrowsAsync<CommandCodeException>(() => api.FetchAsync(Key));
            Assert.Equal(2, calls);
        }
    }

    [Theory]
    [InlineData(500, "server")]
    [InlineData(404, "api-changed")]
    public async Task NonSuccessStatusesMapToFixedErrors(int status, string code)
    {
        using var api = new CommandCodeApi(transport: (_, _, _) =>
            Task.FromResult(new CommandCodeRouteResponse(status, null, null)), clock: () => Now);
        var error = await Assert.ThrowsAsync<CommandCodeException>(() => api.FetchAsync(Key));
        Assert.Equal(code, error.Code);
    }

    [Fact]
    public async Task KeyNeverLeaksIntoDisplayFields()
    {
        using var api = new CommandCodeApi(transport: (path, _, _) => Task.FromResult(
            path.StartsWith("/alpha/usage/summary", StringComparison.Ordinal)
                ? new CommandCodeRouteResponse(200, null, Body("""{"totalCount":1,"totalCredits":2,"periodBasis":"abcdefgh"}"""))
                : path.StartsWith("/alpha/billing/credits", StringComparison.Ordinal)
                    ? new CommandCodeRouteResponse(200, null, Body("""{"credits":{"planId":"abcdefgh"},"windowLimits":{"weekly":{"used":1,"cap":2}}}"""))
                    : path.StartsWith("/alpha/billing/subscriptions", StringComparison.Ordinal)
                        ? new CommandCodeRouteResponse(200, null, Body("""{"data":{"planId":"abcdefgh","status":"active"}}"""))
                        : Route(path)), clock: () => Now);
        var usage = await api.FetchAsync(Key);
        Assert.Null(usage.Plan);
        Assert.Null(usage.PlanId);
        Assert.Null(usage.Consumption.PeriodBasis);
    }

    [Fact]
    public async Task MalformedMandatoryBodyIsRejected()
    {
        using var api = new CommandCodeApi(transport: (path, _, _) => Task.FromResult(
            path.StartsWith("/alpha/billing/credits", StringComparison.Ordinal)
                ? new CommandCodeRouteResponse(200, null, Body("not json"))
                : Route(path)), clock: () => Now);
        var error = await Assert.ThrowsAsync<CommandCodeException>(() => api.FetchAsync(Key));
        Assert.Equal("api-changed", error.Code);
    }

    [Fact]
    public async Task OptionalFailureKeepsMandatoryWindowsAndWarns()
    {
        using var api = new CommandCodeApi(transport: (path, _, _) => Task.FromResult(
            path.StartsWith("/alpha/billing/subscriptions", StringComparison.Ordinal)
                ? new CommandCodeRouteResponse(404, null, null)
                : Route(path)), clock: () => Now);
        var usage = await api.FetchAsync(Key);
        Assert.Single(usage.Windows);
        Assert.Contains("api-changed", usage.Warnings);
    }

    [Fact]
    public async Task ConcurrentFetchesWithSameKeyAreCoalesced()
    {
        var gate = new TaskCompletionSource<CommandCodeRouteResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        using var api = new CommandCodeApi(transport: (path, _, _) =>
        {
            if (path.StartsWith("/alpha/whoami", StringComparison.Ordinal))
            {
                calls++;
                return gate.Task;
            }
            return Task.FromResult(Route(path));
        }, clock: () => Now);
        var first = api.FetchAsync(Key);
        var second = api.FetchAsync(Key);
        Assert.Same(first, second);
        gate.SetResult(new(200, null, Body("""{"user":{"userName":"t"}}""")));
        await first;
        Assert.Equal(1, calls);
    }
}

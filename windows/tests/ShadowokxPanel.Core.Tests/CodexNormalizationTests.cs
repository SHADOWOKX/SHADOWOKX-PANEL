using System.Text.Json;
using ShadowokxPanel.Core.Codex;

namespace ShadowokxPanel.Core.Tests;

public sealed class CodexNormalizationTests
{
    [Fact]
    public void NormalizesWeeklyAndFiveHourRemainingCapacity()
    {
        using var limits = JsonDocument.Parse("""
        {
          "rateLimits": {
            "primary": { "usedPercent": 68, "windowDurationMins": 300, "resetsAt": 2000000000 },
            "secondary": { "usedPercent": 43, "windowDurationMins": 10080, "resetsAt": 2000100000 }
          },
          "rateLimitResetCredits": { "availableCount": 1 }
        }
        """);
        using var usage = JsonDocument.Parse("""
        {
          "summary": { "lifetimeTokens": 10000 },
          "dailyUsageBuckets": [{ "startDate": "2026-08-31", "tokens": 200 }]
        }
        """);
        var state = CodexNormalizer.Normalize(
            limits.RootElement,
            usage.RootElement,
            new DateTimeOffset(2026, 8, 31, 12, 0, 0, TimeSpan.Zero));
        Assert.Equal(32, state.FiveHour?.RemainingPercent);
        Assert.Equal(57, state.Weekly?.RemainingPercent);
        Assert.Equal(1, state.ResetCreditsAvailable);
        Assert.Equal(10_000, state.TokenUsage?.LifetimeTokens);
        Assert.Equal(200, state.TokenUsage?.TodayTokens);
    }

    [Fact]
    public void FutureUnknownWindowFailsClosed()
    {
        using var limits = JsonDocument.Parse("""
        { "rateLimits": { "primary": { "usedPercent": 10, "windowDurationMins": 60 } } }
        """);
        Assert.Throws<InvalidDataException>(() => CodexNormalizer.Normalize(
            limits.RootElement, null, DateTimeOffset.Now));
    }

    [Fact]
    public void InvalidAndNegativeTokenValuesAreIgnored()
    {
        using var limits = JsonDocument.Parse("""
        { "rateLimits": { "primary": { "usedPercent": 10, "windowDurationMins": 10080 } } }
        """);
        using var usage = JsonDocument.Parse("""
        { "dailyUsageBuckets": [
          { "startDate": "invalid", "tokens": 1 },
          { "startDate": "2026-08-31", "tokens": -1 }
        ] }
        """);
        Assert.Null(CodexNormalizer.Normalize(
            limits.RootElement,
            usage.RootElement,
            new DateTimeOffset(2026, 8, 31, 12, 0, 0, TimeSpan.Zero)).TokenUsage);
    }
}

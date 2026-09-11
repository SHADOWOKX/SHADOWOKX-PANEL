using System.Text.Json;
using ShadowokxPanel.Core.Codex;
using ShadowokxPanel.Core.Models;
using ShadowokxPanel.Core.Presentation;

namespace ShadowokxPanel.Core.Tests;

public sealed class AccountUsageRowsTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 31, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void MissingAccountDataIsUnknownRatherThanZero()
    {
        Assert.Equal((null, null, (long?)null), AccountUsageRows.Read(null, Now));
        var usage = new TokenUsage(1500000000, null, null, null, [], null) { AccountDailyBuckets = [] };
        Assert.Equal((null, null, (long?)null), AccountUsageRows.Read(usage, Now));
    }

    [Fact]
    public void RemoteRowsDistinguishReportedZeroAndMissingDays()
    {
        var day = DateOnly.FromDateTime(Now.LocalDateTime);
        var usage = new TokenUsage(null, null, null, null, [], null)
        {
            AccountDailyBuckets = [new(day.AddDays(-1), 0), new(day.AddDays(-5), 200),
                new(day.AddDays(-5), 300), new(day.AddDays(-29), 100),
                new(day.AddDays(-30), 999), new(day.AddDays(1), 999)],
        };
        Assert.Equal(((long?)null, (long?)0, (long?)400), AccountUsageRows.Read(usage, Now));
    }

    [Fact]
    public void NormalizerRetainsOlderAccountDaysWithoutLocalSessions()
    {
        using var limits = JsonDocument.Parse("""{"rateLimits":{"primary":{"usedPercent":77,"windowDurationMins":10080}}}""");
        using var usage = JsonDocument.Parse("""{"dailyUsageBuckets":[{"startDate":"2026-08-05","tokens":123456}]}""");
        var result = CodexNormalizer.Normalize(limits.RootElement, usage.RootElement, Now).TokenUsage;
        Assert.NotNull(result);
        Assert.Empty(result.DailyBuckets);
        Assert.Equal(((long?)null, (long?)null, (long?)123456), AccountUsageRows.Read(result, Now));
    }
}

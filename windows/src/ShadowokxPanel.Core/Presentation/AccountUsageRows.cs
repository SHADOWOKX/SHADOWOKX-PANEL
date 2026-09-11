using ShadowokxPanel.Core.Models;

namespace ShadowokxPanel.Core.Presentation;

public static class AccountUsageRows
{
    public static (long? Today, long? Yesterday, long? Reported30Days) Read(TokenUsage? usage, DateTimeOffset now)
    {
        var day = DateOnly.FromDateTime(now.LocalDateTime);
        var buckets = usage?.AccountDailyBuckets;
        if (buckets is null) return (usage?.TodayTokens, null, null);
        var reported = buckets.Where(b => b.Tokens >= 0 && day.DayNumber - b.Date.DayNumber is >= 0 and < 30)
            .GroupBy(b => b.Date).Select(g => g.Last()).ToArray();
        return (reported.FirstOrDefault(b => b.Date == day)?.Tokens,
            reported.FirstOrDefault(b => b.Date == day.AddDays(-1))?.Tokens,
            reported.Length > 0 ? reported.Sum(b => b.Tokens) : null);
    }
}

using ShadowokxPanel.Core.Models;

namespace ShadowokxPanel.Core.History;

public static class UsageAnalytics
{
    public static UsagePace GetPace(TokenUsage? usage, DateTimeOffset now)
    {
        var today = DateOnly.FromDateTime(now.LocalDateTime);
        var completed = (usage?.DailyBuckets ?? [])
            .Where(bucket => bucket.Date < today && bucket.Tokens >= 0)
            .OrderBy(bucket => bucket.Date)
            .TakeLast(7)
            .ToArray();
        if (completed.Length < 4)
            return UsagePace.Unknown;
        var latest = completed[^1].Tokens;
        var baseline = completed[..^1].Average(bucket => (double)bucket.Tokens);
        if (baseline <= 0)
            return UsagePace.Unknown;
        var ratio = latest / baseline;
        if (ratio >= 1.5)
            return UsagePace.Peak;
        if (ratio <= 0.5)
            return UsagePace.Idle;
        return UsagePace.Steady;
    }

    public static string CapacityLabel(double? remaining)
    {
        if (!remaining.HasValue || !double.IsFinite(remaining.Value))
            return "Unavailable";
        return Math.Clamp((int)Math.Round(remaining.Value), 0, 100) switch
        {
            >= 60 => "Comfortable",
            >= 30 => "Steady",
            >= 15 => "Limited",
            _ => "Low",
        };
    }
}

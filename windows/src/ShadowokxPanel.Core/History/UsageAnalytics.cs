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

    public static (byte Red, byte Green, byte Blue) CapacityColor(double remaining)
    {
        if (!double.IsFinite(remaining)) return (156, 163, 175);
        remaining = Math.Clamp(remaining, 0, 100);
        (double Percent, byte Red, byte Green, byte Blue)[] stops =
            [(0, 239, 68, 68), (15, 249, 115, 22), (30, 245, 158, 11), (60, 34, 197, 94), (100, 34, 197, 94)];
        for (var i = 1; i < stops.Length; i++)
        {
            if (remaining > stops[i].Percent) continue;
            var from = stops[i - 1]; var to = stops[i];
            var fraction = (remaining - from.Percent) / (to.Percent - from.Percent);
            return ((byte)Math.Round(from.Red + (to.Red - from.Red) * fraction),
                (byte)Math.Round(from.Green + (to.Green - from.Green) * fraction),
                (byte)Math.Round(from.Blue + (to.Blue - from.Blue) * fraction));
        }
        return (34, 197, 94);
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

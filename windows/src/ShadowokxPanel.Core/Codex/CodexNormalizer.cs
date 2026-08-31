using System.Globalization;
using System.Text.Json;
using ShadowokxPanel.Core.Models;

namespace ShadowokxPanel.Core.Codex;

public static class CodexNormalizer
{
    private static readonly string[] WindowNames = ["primary", "secondary"];

    public static CodexState Normalize(
        JsonElement response,
        JsonElement? usage,
        DateTimeOffset now)
    {
        var snapshot = GetProperty(response, "rateLimitsByLimitId", out var byId) &&
            GetProperty(byId, "codex", out var codex)
            ? codex
            : GetRequired(response, "rateLimits");
        var windows = WindowNames
            .Select(name => GetProperty(snapshot, name, out var value) ? NormalizeWindow(value) : null)
            .Where(value => value is not null)
            .Cast<UsageWindow>()
            .ToArray();
        var fiveHour = windows.FirstOrDefault(window =>
            window.WindowDurationMinutes is >= 240 and <= 360);
        var weekly = windows.FirstOrDefault(window =>
            window.WindowDurationMinutes is >= 8640 and <= 11520);
        if (fiveHour is null && weekly is null)
            throw new InvalidDataException("Codex did not return a supported rate-limit window.");

        var resetCredits = 0;
        if (GetProperty(response, "rateLimitResetCredits", out var credits) &&
            ReadDouble(credits, "availableCount") is { } available)
            resetCredits = Math.Clamp((int)Math.Round(available), 0, 999);

        return new CodexState
        {
            Status = ProviderStatus.Success,
            FiveHour = fiveHour,
            Weekly = weekly,
            ResetCreditsAvailable = resetCredits,
            TokenUsage = NormalizeUsage(usage, now),
            LastSuccessfulRefresh = now,
        };
    }

    private static UsageWindow? NormalizeWindow(JsonElement value)
    {
        var used = ReadDouble(value, "usedPercent");
        if (!used.HasValue || !double.IsFinite(used.Value))
            return null;
        used = Math.Clamp(used.Value, 0, 100);
        var duration = ReadDouble(value, "windowDurationMins");
        var reset = ReadDouble(value, "resetsAt");
        return new UsageWindow(
            used.Value,
            100 - used.Value,
            reset is > 0 and <= 253402300799
                ? DateTimeOffset.FromUnixTimeSeconds((long)Math.Round(reset.Value))
                : null,
            duration.HasValue && duration.Value is >= 0 and <= int.MaxValue
                ? (int)Math.Round(duration.Value)
                : null);
    }

    private static TokenUsage? NormalizeUsage(JsonElement? optional, DateTimeOffset now)
    {
        if (optional is not { ValueKind: JsonValueKind.Object } usage)
            return null;
        var lifetime = GetProperty(usage, "summary", out var summary)
            ? ReadLong(summary, "lifetimeTokens") : null;
        var peakReported = GetProperty(usage, "summary", out summary)
            ? ReadLong(summary, "peakDailyTokens") : null;
        var buckets = new Dictionary<DateOnly, UsageBucket>();
        if (GetProperty(usage, "dailyUsageBuckets", out var array) &&
            array.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in array.EnumerateArray())
            {
                if (!GetProperty(item, "startDate", out var dateValue) ||
                    dateValue.ValueKind != JsonValueKind.String ||
                    !DateOnly.TryParseExact(
                        dateValue.GetString(),
                        "yyyy-MM-dd",
                        CultureInfo.InvariantCulture,
                        DateTimeStyles.None,
                        out var date) ||
                    ReadLong(item, "tokens") is not { } tokens)
                    continue;
                buckets[date] = new UsageBucket(date, tokens);
            }
        }
        var today = DateOnly.FromDateTime(now.LocalDateTime);
        var recent = buckets.Values
            .Where(bucket => today.DayNumber - bucket.Date.DayNumber is >= 0 and < 7)
            .OrderBy(bucket => bucket.Date)
            .TakeLast(7)
            .ToArray();
        var peak = recent.OrderByDescending(bucket => bucket.Tokens).FirstOrDefault();
        if (!lifetime.HasValue && peak is null && !buckets.ContainsKey(today))
            return null;
        var peakTokens = peakReported ?? peak?.Tokens;
        var peakDate = recent.FirstOrDefault(bucket => bucket.Tokens == peakTokens)?.Date;
        return new TokenUsage(
            lifetime,
            buckets.GetValueOrDefault(today)?.Tokens,
            peakTokens,
            peakDate,
            recent,
            recent.Length > 0 ? recent.Sum(bucket => bucket.Tokens) : null);
    }

    private static JsonElement GetRequired(JsonElement parent, string name) =>
        GetProperty(parent, name, out var value) && value.ValueKind == JsonValueKind.Object
            ? value
            : throw new InvalidDataException($"Codex response is missing {name}.");

    private static bool GetProperty(JsonElement parent, string name, out JsonElement value)
    {
        if (parent.ValueKind == JsonValueKind.Object && parent.TryGetProperty(name, out value))
            return true;
        value = default;
        return false;
    }

    private static double? ReadDouble(JsonElement parent, string name)
    {
        if (!GetProperty(parent, name, out var value) || value.ValueKind != JsonValueKind.Number ||
            !value.TryGetDouble(out var number) || !double.IsFinite(number))
            return null;
        return number;
    }

    private static long? ReadLong(JsonElement parent, string name)
    {
        if (!GetProperty(parent, name, out var value) || value.ValueKind != JsonValueKind.Number ||
            !value.TryGetInt64(out var number) || number < 0)
            return null;
        return number;
    }
}

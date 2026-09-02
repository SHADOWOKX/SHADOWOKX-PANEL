using ShadowokxPanel.Core.Models;
using ShadowokxPanel.Core.Storage;

namespace ShadowokxPanel.Core.History;

public sealed record TokenHistoryDocument(
    int Version,
    DateTimeOffset StartedAt,
    IReadOnlyList<UsageBucket> DailyBuckets)
{
    public static TokenHistoryDocument Empty(DateTimeOffset now) => new(1, now, []);
}

public sealed class TokenHistoryStore
{
    private const int Version = 1;
    private readonly JsonFileStore<TokenHistoryDocument> _store;

    public TokenHistoryStore(ApplicationPaths paths)
    {
        _store = new JsonFileStore<TokenHistoryDocument>(paths.HistoryFile);
    }

    public async Task<TokenHistoryDocument> LoadAsync(
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        var value = await _store.ReadAsync(cancellationToken).ConfigureAwait(false);
        return Normalize(value, now);
    }

    public async Task<TokenHistoryDocument> MergeAsync(
        TokenHistoryDocument history,
        TokenUsage? liveUsage,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        var normalized = Normalize(history, now);
        var today = DateOnly.FromDateTime(now.LocalDateTime);
        var current = liveUsage?.DailyBuckets.LastOrDefault(bucket => bucket.Date == today);
        if (current is not null)
        {
            var merged = normalized.DailyBuckets
                .Where(bucket => bucket.Date != today)
                .Append(current)
                .ToArray();
            normalized = normalized with { DailyBuckets = Bounded(merged, now) };
        }
        if (!normalized.DailyBuckets.SequenceEqual(history.DailyBuckets) ||
            normalized.StartedAt != history.StartedAt || normalized.Version != history.Version)
            await _store.WriteAsync(normalized, cancellationToken).ConfigureAwait(false);
        return normalized;
    }

    public Task ClearAsync(CancellationToken cancellationToken = default) =>
        _store.DeleteAsync(cancellationToken);

    public static TokenHistoryDocument Normalize(TokenHistoryDocument? value, DateTimeOffset now)
    {
        if (value is null || value.Version != Version || value.StartedAt > now.AddMinutes(5))
            return TokenHistoryDocument.Empty(now);
        return value with { DailyBuckets = Bounded(value.DailyBuckets, now) };
    }

    public static TokenUsage? Apply(TokenUsage? usage, TokenHistoryDocument history, DateTimeOffset now)
    {
        var buckets = Bounded(history.DailyBuckets, now);
        if (usage is null && buckets.Length == 0)
            return null;
        var peak = buckets.OrderByDescending(bucket => bucket.Tokens).FirstOrDefault();
        var today = DateOnly.FromDateTime(now.LocalDateTime);
        return new TokenUsage(
            usage?.LifetimeTokens,
            buckets.FirstOrDefault(bucket => bucket.Date == today)?.Tokens ?? usage?.TodayTokens,
            peak?.Tokens,
            peak?.Date,
            buckets,
            buckets.Length > 0 ? buckets.Sum(bucket => bucket.Tokens) : null);
    }

    public static TokenUsage? WithoutHistory(TokenUsage? usage) => usage is null ? null :
        new TokenUsage(usage.LifetimeTokens, usage.TodayTokens, null, null, [], null);

    private static UsageBucket[] Bounded(
        IEnumerable<UsageBucket>? values,
        DateTimeOffset now)
    {
        var today = DateOnly.FromDateTime(now.LocalDateTime);
        return (values ?? [])
            .Where(bucket => bucket.Tokens >= 0)
            .Where(bucket => today.DayNumber - bucket.Date.DayNumber is >= 0 and < 7)
            .GroupBy(bucket => bucket.Date)
            .Select(group => group.Last())
            .OrderBy(bucket => bucket.Date)
            .TakeLast(7)
            .ToArray();
    }
}

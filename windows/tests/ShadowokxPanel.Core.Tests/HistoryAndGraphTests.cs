using ShadowokxPanel.Core.History;
using ShadowokxPanel.Core.Models;

namespace ShadowokxPanel.Core.Tests;

public sealed class HistoryAndGraphTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 31, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void NewHistoryIsEmpty()
    {
        Assert.Empty(TokenHistoryStore.Normalize(null, Now).DailyBuckets);
    }

    [Fact]
    public async Task CurrentDayMergesWithoutImportingOlderAccountBuckets()
    {
        var history = TokenHistoryDocument.Empty(Now);
        var usage = new TokenUsage(5000, 200, 999, new DateOnly(2026, 8, 30),
        [
            new UsageBucket(new DateOnly(2026, 8, 30), 999),
            new UsageBucket(new DateOnly(2026, 8, 31), 200),
        ], 1199);
        using var temporary = TemporaryDirectory.Create();
        var store = new TokenHistoryStore(temporary.Paths);
        var merged = await store.MergeAsync(history, usage, Now);
        var single = Assert.Single(merged.DailyBuckets);
        Assert.Equal(new DateOnly(2026, 8, 31), single.Date);
        Assert.Equal(200, single.Tokens);
    }

    [Fact]
    public async Task SameDayRefreshReplacesInsteadOfDuplicating()
    {
        using var temporary = TemporaryDirectory.Create();
        var store = new TokenHistoryStore(temporary.Paths);
        var history = TokenHistoryDocument.Empty(Now);
        history = await store.MergeAsync(history, Usage(100), Now);
        history = await store.MergeAsync(history, Usage(250), Now);
        Assert.Single(history.DailyBuckets);
        Assert.Equal(250, history.DailyBuckets[0].Tokens);
    }

    [Fact]
    public void GraphPreservesMissingDaySpacingAndZeroBaseline()
    {
        var points = GraphMath.Calculate([
            new UsageBucket(new DateOnly(2026, 8, 27), 100),
            new UsageBucket(new DateOnly(2026, 8, 29), 200),
            new UsageBucket(new DateOnly(2026, 8, 30), 0),
        ], 200, 80);
        Assert.Equal(3, points.Count);
        Assert.Equal(2d / 3d, points[1].Position, 6);
        Assert.True(points[2].Y > points[0].Y);
    }

    [Theory]
    [InlineData(20, 100, 100, 100, UsagePace.Idle)]
    [InlineData(100, 100, 100, 100, UsagePace.Steady)]
    [InlineData(200, 100, 100, 100, UsagePace.Peak)]
    public void UsagePaceMatchesLinuxThresholds(
        long latest, long first, long second, long third, UsagePace expected)
    {
        var usage = new TokenUsage(null, null, null, null,
        [
            new UsageBucket(new DateOnly(2026, 8, 26), first),
            new UsageBucket(new DateOnly(2026, 8, 27), second),
            new UsageBucket(new DateOnly(2026, 8, 28), third),
            new UsageBucket(new DateOnly(2026, 8, 29), latest),
        ], null);
        Assert.Equal(expected, UsageAnalytics.GetPace(usage, Now));
    }

    [Fact]
    public void InsufficientHistoryDoesNotInventUsagePace()
    {
        Assert.Equal(UsagePace.Unknown, UsageAnalytics.GetPace(Usage(100), Now));
    }

    private static TokenUsage Usage(long tokens) => new(
        5000, tokens, tokens, new DateOnly(2026, 8, 31),
        [new UsageBucket(new DateOnly(2026, 8, 31), tokens)], tokens);
}

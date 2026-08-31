using System.Text.Json;

namespace ShadowokxPanel.Core.Models;

public enum ProviderStatus
{
    Loading,
    Success,
    Cached,
    Refreshing,
    Stale,
    Error,
}

public enum UsagePace
{
    Unknown,
    Idle,
    Steady,
    Peak,
}

public sealed record UsageWindow(
    double UsedPercent,
    double RemainingPercent,
    DateTimeOffset? ResetsAt,
    int? WindowDurationMinutes);

public sealed record UsageBucket(DateOnly Date, long Tokens);

public sealed record TokenUsage(
    long? LifetimeTokens,
    long? TodayTokens,
    long? PeakDailyTokens,
    DateOnly? PeakDate,
    IReadOnlyList<UsageBucket> DailyBuckets,
    long? SevenDayTokens);

public sealed record CodexState
{
    public ProviderStatus Status { get; init; } = ProviderStatus.Loading;
    public string? ErrorCode { get; init; }
    public string? ErrorMessage { get; init; }
    public UsageWindow? FiveHour { get; init; }
    public UsageWindow? Weekly { get; init; }
    public int ResetCreditsAvailable { get; init; }
    public TokenUsage? TokenUsage { get; init; }
    public DateTimeOffset? LastSuccessfulRefresh { get; init; }
    public bool IsStale => Status is ProviderStatus.Stale or ProviderStatus.Cached;
    public bool HasData => Weekly is not null || FiveHour is not null;
}

public sealed record CodexProtocolResponse(
    JsonElement RateLimits,
    JsonElement? Usage);

public sealed record CodexLaunchSpec(string ExecutablePath, bool IsCommandShim)
{
    public override string ToString() => ExecutablePath;
}

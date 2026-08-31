namespace ShadowokxPanel.Core.Models;

public sealed record WeatherCondition(string Label, string Symbol);

public sealed record WeatherCurrent(
    double Temperature,
    double FeelsLike,
    double Humidity,
    double Wind,
    double? RainProbability,
    WeatherCondition Condition);

public sealed record WeatherToday(
    double High,
    double Low,
    double? Uv,
    DateTimeOffset? Sunrise,
    DateTimeOffset? Sunset);

public sealed record ForecastHour(
    DateTimeOffset Time,
    double Temperature,
    double? PrecipitationChance,
    WeatherCondition Condition);

public sealed record ResolvedLocation(
    string Query,
    double Latitude,
    double Longitude,
    string DisplayName);

public sealed record WeatherState
{
    public ProviderStatus Status { get; init; } = ProviderStatus.Loading;
    public string? ErrorMessage { get; init; }
    public string Location { get; init; } = string.Empty;
    public string Unit { get; init; } = "celsius";
    public string? TimeZone { get; init; }
    public WeatherCurrent? Current { get; init; }
    public WeatherToday? Today { get; init; }
    public IReadOnlyList<ForecastHour> Forecast { get; init; } = [];
    public DateTimeOffset? LastSuccessfulRefresh { get; init; }
    public bool IsStale => Status is ProviderStatus.Stale or ProviderStatus.Cached;
    public bool HasData => Current is not null && Today is not null;
}

public sealed record WeatherCache(WeatherState State, ResolvedLocation ResolvedLocation);

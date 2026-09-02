using System.Text.Json;
using System.Text.RegularExpressions;
using ShadowokxPanel.Core.Models;

namespace ShadowokxPanel.Core.Weather;

public static partial class WeatherNormalizer
{
    private static readonly IReadOnlyDictionary<int, WeatherCondition> Conditions =
        new Dictionary<int, WeatherCondition>
        {
            [0] = new("Clear sky", "clear-day"),
            [1] = new("Mainly clear", "partly-cloudy-day"),
            [2] = new("Partly cloudy", "partly-cloudy-day"),
            [3] = new("Overcast", "overcast"),
            [45] = new("Fog", "fog"), [48] = new("Rime fog", "fog"),
            [51] = new("Light drizzle", "drizzle"), [53] = new("Drizzle", "drizzle"),
            [55] = new("Heavy drizzle", "rain"), [56] = new("Light freezing drizzle", "drizzle"),
            [57] = new("Freezing drizzle", "rain"), [61] = new("Light rain", "drizzle"),
            [63] = new("Rain", "rain"), [65] = new("Heavy rain", "heavy-rain"),
            [66] = new("Light freezing rain", "rain"), [67] = new("Freezing rain", "rain"),
            [71] = new("Light snow", "snow"), [73] = new("Snow", "snow"),
            [75] = new("Heavy snow", "snow"), [77] = new("Snow grains", "snow"),
            [80] = new("Rain showers", "showers"), [81] = new("Rain showers", "showers"),
            [82] = new("Heavy showers", "heavy-rain"), [85] = new("Light snow showers", "snow"),
            [86] = new("Heavy snow showers", "snow"), [95] = new("Thunderstorm", "thunderstorm"),
            [96] = new("Thunderstorm with hail", "thunderstorm"), [99] = new("Heavy thunderstorm", "thunderstorm"),
        };

    public static WeatherState Normalize(
        JsonElement payload,
        string location,
        string unit,
        DateTimeOffset now)
    {
        var current = RequiredObject(payload, "current");
        var daily = RequiredObject(payload, "daily");
        var temperature = RequiredRange(current, "temperature_2m", -150, 150);
        var feelsLike = RequiredRange(current, "apparent_temperature", -150, 150);
        var humidity = RequiredRange(current, "relative_humidity_2m", 0, 100);
        var wind = RequiredRange(current, "wind_speed_10m", 0, 1000);
        var high = RequiredArrayNumber(daily, "temperature_2m_max", -150, 150);
        var low = RequiredArrayNumber(daily, "temperature_2m_min", -150, 150);
        var currentTime = ReadUnix(current, "time") ?? now;
        var forecast = NormalizeForecast(payload, currentTime);

        return new WeatherState
        {
            Status = ProviderStatus.Success,
            Location = CleanText(location, 240),
            Unit = unit == "fahrenheit" ? "fahrenheit" : "celsius",
            TimeZone = ReadString(payload, "timezone") is { } zone && TimeZonePattern().IsMatch(zone)
                ? zone : null,
            Current = new WeatherCurrent(
                temperature,
                feelsLike,
                humidity,
                wind,
                forecast.Count > 0 ? forecast[0].PrecipitationChance : null,
                Condition(
                    (int)(ReadDouble(current, "weather_code") ?? -1),
                    ReadDouble(current, "is_day") != 0)),
            Today = new WeatherToday(
                high,
                low,
                OptionalArrayNumber(daily, "uv_index_max", 0, 100),
                OptionalArrayUnix(daily, "sunrise"),
                OptionalArrayUnix(daily, "sunset")),
            Forecast = forecast,
            LastSuccessfulRefresh = now,
        };
    }

    public static string NormalizeQuery(string? value)
    {
        var clean = Whitespace().Replace(ControlCharacters().Replace(value ?? string.Empty, " "), " ")
            .Trim();
        if (string.IsNullOrWhiteSpace(clean))
            return "Cairo, Egypt";
        return clean.Length <= 120 ? clean : clean[..120];
    }

    public static IReadOnlyList<string> SearchQueries(string value)
    {
        var query = NormalizeQuery(value);
        var comma = query.IndexOf(',');
        var place = comma >= 0 ? query[..comma] : query;
        var suffix = comma >= 0 ? query[comma..] : string.Empty;
        var relaxed = Dashes().Replace(place, " ");
        relaxed = Whitespace().Replace(relaxed, " ").Trim() + suffix;
        return relaxed != query ? [query, relaxed] : [query];
    }

    public static WeatherCondition Condition(int code, bool isDay = true)
    {
        var condition = Conditions.GetValueOrDefault(
            code, new WeatherCondition("Unknown conditions", "unknown"));
        return !isDay ? condition.Symbol switch
        {
            "clear-day" => condition with { Symbol = "clear-night" },
            "partly-cloudy-day" => condition with { Symbol = "partly-cloudy-night" },
            _ => condition,
        } : condition;
    }

    private static List<ForecastHour> NormalizeForecast(
        JsonElement payload,
        DateTimeOffset currentTime)
    {
        if (!payload.TryGetProperty("hourly", out var hourly) ||
            hourly.ValueKind != JsonValueKind.Object ||
            !TryArray(hourly, "time", out var times))
            return [];
        TryArray(hourly, "temperature_2m", out var temperatures);
        TryArray(hourly, "weather_code", out var codes);
        TryArray(hourly, "is_day", out var dayStates);
        TryArray(hourly, "precipitation_probability", out var precipitation);
        var result = new List<ForecastHour>();
        for (var index = 0; index < times.GetArrayLength() && result.Count < 12; index++)
        {
            var time = ReadUnix(times[index]);
            var temperature = ReadDouble(temperatures, index);
            if (!time.HasValue || time < currentTime || !temperature.HasValue ||
                temperature.Value is < -150 or > 150)
                continue;
            var rain = ReadDouble(precipitation, index);
            var code = ReadDouble(codes, index);
            result.Add(new ForecastHour(
                time.Value,
                temperature.Value,
                rain.HasValue ? Math.Clamp(Math.Round(rain.Value), 0, 100) : null,
                Condition(
                    code.HasValue ? (int)code.Value : -1,
                    ReadDouble(dayStates, index) != 0)));
        }
        return result;
    }

    private static JsonElement RequiredObject(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object
            ? value : throw new InvalidDataException($"Weather response is missing {name}.");

    private static double RequiredRange(JsonElement parent, string name, double min, double max)
    {
        var value = ReadDouble(parent, name);
        return value is not null && value >= min && value <= max
            ? value.Value : throw new InvalidDataException($"Weather response contains invalid {name}.");
    }

    private static double RequiredArrayNumber(JsonElement parent, string name, double min, double max)
    {
        if (!TryArray(parent, name, out var values) || values.GetArrayLength() == 0)
            throw new InvalidDataException($"Weather response is missing {name}.");
        var value = ReadDouble(values, 0);
        return value is not null && value >= min && value <= max
            ? value.Value : throw new InvalidDataException($"Weather response contains invalid {name}.");
    }

    private static double? OptionalArrayNumber(JsonElement parent, string name, double min, double max)
    {
        if (!TryArray(parent, name, out var values) || values.GetArrayLength() == 0)
            return null;
        var value = ReadDouble(values, 0);
        return value is not null && value >= min && value <= max ? value : null;
    }

    private static DateTimeOffset? OptionalArrayUnix(JsonElement parent, string name) =>
        TryArray(parent, name, out var values) && values.GetArrayLength() > 0
            ? ReadUnix(values[0]) : null;

    private static bool TryArray(JsonElement parent, string name, out JsonElement value)
    {
        if (parent.ValueKind == JsonValueKind.Object && parent.TryGetProperty(name, out value) &&
            value.ValueKind == JsonValueKind.Array)
            return true;
        value = default;
        return false;
    }

    private static double? ReadDouble(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object && parent.TryGetProperty(name, out var value)
            ? ReadDouble(value) : null;

    private static double? ReadDouble(JsonElement array, int index) =>
        array.ValueKind == JsonValueKind.Array && index >= 0 && index < array.GetArrayLength()
            ? ReadDouble(array[index]) : null;

    private static double? ReadDouble(JsonElement value) =>
        value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) &&
        double.IsFinite(number) ? number : null;

    private static DateTimeOffset? ReadUnix(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var value) ? ReadUnix(value) : null;

    private static DateTimeOffset? ReadUnix(JsonElement value)
    {
        var seconds = ReadDouble(value);
        return seconds is > 0 and <= 253402300799
            ? DateTimeOffset.FromUnixTimeSeconds((long)Math.Round(seconds.Value)) : null;
    }

    private static string? ReadString(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() : null;

    private static string CleanText(string value, int maximum)
    {
        var clean = ControlCharacters().Replace(value, string.Empty).Trim();
        return clean.Length <= maximum ? clean : clean[..maximum];
    }

    [GeneratedRegex("[\\u0000-\\u001f\\u007f\\u202a-\\u202e\\u2066-\\u2069]")]
    private static partial Regex ControlCharacters();

    [GeneratedRegex("\\s+")]
    private static partial Regex Whitespace();

    [GeneratedRegex("[-\\u2010-\\u2015]+")]
    private static partial Regex Dashes();

    [GeneratedRegex("^[A-Za-z0-9_+./-]{1,80}$")]
    private static partial Regex TimeZonePattern();
}

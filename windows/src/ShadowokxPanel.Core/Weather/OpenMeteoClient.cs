using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using ShadowokxPanel.Core.Models;

namespace ShadowokxPanel.Core.Weather;

public interface IWeatherClient
{
    Task<(WeatherState State, ResolvedLocation Location)> ReadAsync(
        string query,
        string unit,
        CancellationToken cancellationToken = default);
}

public sealed class OpenMeteoClient(HttpClient? httpClient = null) : IWeatherClient, IDisposable
{
    private const int MaximumResponseBytes = 1_048_576;
    private readonly HttpClient _http = httpClient ?? new HttpClient
    {
        Timeout = TimeSpan.FromSeconds(15),
        DefaultRequestHeaders = { UserAgent = { ProductInfoHeaderValue.Parse("ShadowokxPanel/1.0") } },
    };
    private readonly bool _ownsClient = httpClient is null;

    public async Task<(WeatherState State, ResolvedLocation Location)> ReadAsync(
        string query,
        string unit,
        CancellationToken cancellationToken = default)
    {
        var normalized = WeatherNormalizer.NormalizeQuery(query);
        ResolvedLocation? location = null;
        foreach (var candidate in WeatherNormalizer.SearchQueries(normalized))
        {
            var uri = new Uri("https://geocoding-api.open-meteo.com/v1/search?" +
                $"name={Uri.EscapeDataString(candidate)}&count=1&language=en&format=json");
            using var result = await GetJsonAsync(uri, cancellationToken).ConfigureAwait(false);
            if (!result.RootElement.TryGetProperty("results", out var array) ||
                array.ValueKind != JsonValueKind.Array || array.GetArrayLength() == 0)
                continue;
            var item = array[0];
            var latitude = Number(item, "latitude");
            var longitude = Number(item, "longitude");
            var name = CleanPart(String(item, "name"));
            if (!latitude.HasValue || latitude.Value is < -90 or > 90 ||
                !longitude.HasValue || longitude.Value is < -180 or > 180 ||
                string.IsNullOrWhiteSpace(name))
                continue;
            var admin = CleanPart(String(item, "admin1"));
            var country = CleanPart(String(item, "country"));
            var suffix = new[] { admin, country }
                .Where(value => !string.IsNullOrWhiteSpace(value) &&
                    !value.Equals(name, StringComparison.OrdinalIgnoreCase));
            var display = string.Join(", ", new[] { name }.Concat(suffix));
            location = new ResolvedLocation(
                normalized,
                latitude.Value,
                longitude.Value,
                display.Length <= 240 ? display : display[..240]);
            break;
        }
        if (location is null)
            throw new WeatherProviderException("Location not found. Try “City, Country”.");

        var culture = CultureInfo.InvariantCulture;
        var forecastUri = new Uri("https://api.open-meteo.com/v1/forecast?" + string.Join('&',
        [
            $"latitude={location.Latitude.ToString(culture)}",
            $"longitude={location.Longitude.ToString(culture)}",
            "current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
            "hourly=temperature_2m,weather_code,precipitation_probability,is_day",
            "daily=temperature_2m_max,temperature_2m_min,uv_index_max,sunrise,sunset",
            $"temperature_unit={(unit == "fahrenheit" ? "fahrenheit" : "celsius")}",
            "wind_speed_unit=kmh",
            "timeformat=unixtime",
            "timezone=auto",
            "forecast_days=2",
        ]));
        using var forecast = await GetJsonAsync(forecastUri, cancellationToken).ConfigureAwait(false);
        return (WeatherNormalizer.Normalize(
            forecast.RootElement,
            location.DisplayName,
            unit,
            DateTimeOffset.Now), location);
    }

    private async Task<JsonDocument> GetJsonAsync(Uri uri, CancellationToken cancellationToken)
    {
        using var response = await _http.GetAsync(
            uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        if (response.StatusCode == HttpStatusCode.TooManyRequests)
            throw new WeatherProviderException("Open-Meteo is busy. Cached weather will be retained.");
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength is > MaximumResponseBytes)
            throw new InvalidDataException("Weather response exceeded the safe size limit.");
        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken)
            .ConfigureAwait(false);
        await using var bounded = new MemoryStream();
        var buffer = new byte[16 * 1024];
        while (true)
        {
            var count = await source.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (count == 0)
                break;
            if (bounded.Length + count > MaximumResponseBytes)
                throw new InvalidDataException("Weather response exceeded the safe size limit.");
            await bounded.WriteAsync(buffer.AsMemory(0, count), cancellationToken).ConfigureAwait(false);
        }
        bounded.Position = 0;
        return await JsonDocument.ParseAsync(bounded, cancellationToken: cancellationToken)
            .ConfigureAwait(false);
    }

    private static double? Number(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var value) && value.TryGetDouble(out var number) &&
        double.IsFinite(number) ? number : null;

    private static string String(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? string.Empty : string.Empty;

    private static string CleanPart(string value)
    {
        var clean = new string(value.Where(character => !char.IsControl(character)).ToArray()).Trim();
        return clean.Length <= 80 ? clean : clean[..80];
    }

    public void Dispose()
    {
        if (_ownsClient)
            _http.Dispose();
    }
}

public sealed class WeatherProviderException(string message) : Exception(message);

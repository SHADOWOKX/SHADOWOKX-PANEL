using System.Text.Json;
using ShadowokxPanel.Core.Weather;

namespace ShadowokxPanel.Core.Tests;

public sealed class WeatherNormalizationTests
{
    [Fact]
    public void NormalizesCurrentDetailsAndTwelveHoursMaximum()
    {
        var now = DateTimeOffset.FromUnixTimeSeconds(2_000_000_000);
        using var payload = JsonDocument.Parse(BuildWeather(now));
        var state = WeatherNormalizer.Normalize(payload.RootElement, "Port Said, Egypt", "celsius", now);
        Assert.Equal(29, state.Current?.Temperature);
        Assert.Equal(48, state.Current?.Humidity);
        Assert.Equal(7, state.Today?.Uv);
        Assert.Equal(12, state.Forecast.Count);
        Assert.Equal("clear-day", state.Current?.Condition.Symbol);
        Assert.All(state.Forecast, hour => Assert.Equal("clear-day", hour.Condition.Symbol));
    }

    [Fact]
    public void DayNightAndUnknownConditionsAlwaysHaveOwnedIconKeys()
    {
        Assert.Equal("clear-night", WeatherNormalizer.Condition(0, isDay: false).Symbol);
        Assert.Equal("partly-cloudy-night", WeatherNormalizer.Condition(2, isDay: false).Symbol);
        Assert.Equal("thunderstorm", WeatherNormalizer.Condition(95).Symbol);
        Assert.Equal("unknown", WeatherNormalizer.Condition(-1).Symbol);
    }

    [Fact]
    public void InvalidHumidityFailsClosed()
    {
        var now = DateTimeOffset.FromUnixTimeSeconds(2_000_000_000);
        using var payload = JsonDocument.Parse(BuildWeather(now).Replace(
            "\"relative_humidity_2m\":48", "\"relative_humidity_2m\":148"));
        Assert.Throws<InvalidDataException>(() => WeatherNormalizer.Normalize(
            payload.RootElement, "Cairo", "celsius", now));
    }

    [Fact]
    public void QueryNormalizationRemovesControlsAndBoundsLength()
    {
        var value = WeatherNormalizer.NormalizeQuery("  Port\u0000   Said, Egypt  ");
        Assert.Equal("Port Said, Egypt", value);
        Assert.Equal("Cairo, Egypt", WeatherNormalizer.NormalizeQuery(""));
    }

    private static string BuildWeather(DateTimeOffset now)
    {
        var times = string.Join(',', Enumerable.Range(0, 16)
            .Select(index => now.AddHours(index).ToUnixTimeSeconds()));
        var temperatures = string.Join(',', Enumerable.Range(0, 16).Select(index => 29 - index * 0.2));
        var codes = string.Join(',', Enumerable.Repeat(0, 16));
        var rain = string.Join(',', Enumerable.Repeat(0, 16));
        return $$"""
        {
          "timezone":"Africa/Cairo",
          "current":{
            "time":{{now.ToUnixTimeSeconds()}},"temperature_2m":29,"apparent_temperature":31,
            "relative_humidity_2m":48,"weather_code":0,"wind_speed_10m":12,"is_day":1
          },
          "daily":{
            "temperature_2m_max":[32],"temperature_2m_min":[24],"uv_index_max":[7],
            "sunrise":[{{now.AddHours(-6).ToUnixTimeSeconds()}}],"sunset":[{{now.AddHours(6).ToUnixTimeSeconds()}}]
          },
          "hourly":{
            "time":[{{times}}],"temperature_2m":[{{temperatures}}],
            "weather_code":[{{codes}}],"precipitation_probability":[{{rain}}],
            "is_day":[{{string.Join(',', Enumerable.Repeat(1, 16))}}]
          }
        }
        """;
    }
}

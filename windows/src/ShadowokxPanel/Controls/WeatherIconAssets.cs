using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;

namespace ShadowokxPanel.Controls;

internal static class WeatherIconAssets
{
    private static readonly Dictionary<string, string> Files =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["clear-day"] = "clear-day.svg",
            ["clear-night"] = "clear-night.svg",
            ["partly-cloudy-day"] = "partly-cloudy-day.svg",
            ["partly-cloudy-night"] = "partly-cloudy-night.svg",
            ["cloudy"] = "cloudy.svg",
            ["overcast"] = "overcast.svg",
            ["fog"] = "fog.svg",
            ["drizzle"] = "drizzle.svg",
            ["rain"] = "rain.svg",
            ["heavy-rain"] = "heavy-rain.svg",
            ["snow"] = "snow.svg",
            ["showers"] = "showers.svg",
            ["thunderstorm"] = "thunderstorm.svg",
            ["unknown"] = "unknown.svg",
            ["sun"] = "clear-day.svg",
            ["partly-cloudy"] = "partly-cloudy-day.svg",
            ["cloud"] = "cloudy.svg",
            ["storm"] = "thunderstorm.svg",
            ["alert"] = "unknown.svg",
        };
    private static readonly Dictionary<string, SvgImageSource> Sources =
        new(StringComparer.OrdinalIgnoreCase);

    public static Image Create(string? symbol, double size)
    {
        var image = new Image
        {
            Width = size,
            Height = size,
            Stretch = Microsoft.UI.Xaml.Media.Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Set(image, symbol);
        return image;
    }

    public static void Set(Image image, string? symbol) => image.Source = Source(symbol);

    private static SvgImageSource Source(string? symbol)
    {
        var key = symbol is not null && Files.ContainsKey(symbol) ? symbol : "unknown";
        if (Sources.TryGetValue(key, out var source))
            return source;
        source = new SvgImageSource(new Uri($"ms-appx:///Assets/Weather/{Files[key]}"));
        Sources[key] = source;
        return source;
    }
}

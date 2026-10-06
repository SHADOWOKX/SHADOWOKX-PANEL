using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using ShadowokxPanel.Core.Settings;
using Windows.UI;

namespace ShadowokxPanel.Services;

public static class ThemeService
{
    private sealed record Palette(string Background, string Card, string Hover, string Border,
        string Primary, string Secondary, ElementTheme BaseTheme);

    private static readonly IReadOnlyDictionary<ThemePreset, Palette> Palettes =
        new Dictionary<ThemePreset, Palette>
        {
            [ThemePreset.Shadow] = new("#30312f", "#393a38", "#3d3e3c", "#4b4c4a", "#f4f4f4", "#a6a9a6", ElementTheme.Dark),
            [ThemePreset.Midnight] = new("#151820", "#1d222d", "#252b37", "#343b49", "#f4f7fb", "#9da8b8", ElementTheme.Dark),
            [ThemePreset.Graphite] = new("#15171a", "#1f2226", "#292d32", "#343941", "#f5f6f7", "#a5abb3", ElementTheme.Dark),
            [ThemePreset.Nord] = new("#242933", "#2e3440", "#3b4252", "#4c566a", "#eceff4", "#b6c0d1", ElementTheme.Dark),
            [ThemePreset.Amoled] = new("#000000", "#0c0c0d", "#171719", "#262629", "#ffffff", "#a9a9ae", ElementTheme.Dark),
            [ThemePreset.Gnome] = new("#242424", "#303030", "#3d3d3d", "#484848", "#fafafa", "#b7b7b7", ElementTheme.Dark),
            [ThemePreset.SoftNeutral] = new("#e8e6e1", "#f7f5f0", "#ffffff", "#d4d1c9", "#252522", "#6b6b64", ElementTheme.Light),
            [ThemePreset.Terminal] = new("#101811", "#17231a", "#203126", "#314635", "#d7ffe2", "#91b89d", ElementTheme.Dark),
            [ThemePreset.Clay] = new("#302823", "#3b322c", "#494036", "#605044", "#fff0df", "#c7b5a2", ElementTheme.Dark),
            [ThemePreset.Glacier] = new("#182b35", "#223b47", "#2b4855", "#3b5e6b", "#e9f9ff", "#a3c5d4", ElementTheme.Dark),
            [ThemePreset.Dracula] = new("#282a36", "#303341", "#3c4050", "#4b5064", "#f8f8f2", "#a5a7ba", ElementTheme.Dark),
            [ThemePreset.Catppuccin] = new("#1e1e2e", "#272739", "#313147", "#45455d", "#cdd6f4", "#a6adc8", ElementTheme.Dark),
            [ThemePreset.Ocean] = new("#102330", "#173140", "#214354", "#33576a", "#e5f5ff", "#98becf", ElementTheme.Dark),
            [ThemePreset.Forest] = new("#15251d", "#203329", "#2d4638", "#405e4b", "#e3f5e8", "#a4c5ae", ElementTheme.Dark),
            [ThemePreset.Dusk] = new("#252136", "#302b43", "#3b3451", "#504763", "#f3eafd", "#b9aeca", ElementTheme.Dark),
            [ThemePreset.Mocha] = new("#2b2322", "#382e2c", "#443835", "#584744", "#ffefdf", "#c5aaa0", ElementTheme.Dark),
            [ThemePreset.Lavender] = new("#eeeaf6", "#f8f5ff", "#e3dcf0", "#cfc4e0", "#332a43", "#766789", ElementTheme.Light),
            [ThemePreset.Light] = new("#efefeb", "#e8e8e4", "#e0e0dc", "#d2d2ce", "#252624", "#70736f", ElementTheme.Light),
        };

    private static readonly IReadOnlyDictionary<AccentPreset, string> Accents =
        new Dictionary<AccentPreset, string>
        {
            [AccentPreset.Rose] = "#f43f5e",
            [AccentPreset.Orange] = "#f97316",
            [AccentPreset.Emerald] = "#10b981",
            [AccentPreset.Cyan] = "#06b6d4",
            [AccentPreset.Blue] = "#3b82f6",
            [AccentPreset.Violet] = "#8b5cf6",
            [AccentPreset.Amber] = "#f59e0b",
            [AccentPreset.Teal] = "#14b8a6",
            [AccentPreset.Pink] = "#ec4899",
            [AccentPreset.Red] = "#ef4444",
            [AccentPreset.Indigo] = "#6366f1",
            [AccentPreset.Lime] = "#84cc16",
            [AccentPreset.Monochrome] = "#94a3b8",
        };

    public static void Apply(FrameworkElement root, AppSettings settings)
    {
        var preset = settings.Theme;
        if (preset == ThemePreset.System)
        {
            root.RequestedTheme = ElementTheme.Default;
            preset = Application.Current.RequestedTheme == ApplicationTheme.Light
                ? ThemePreset.Light : ThemePreset.Shadow;
        }
        var palette = Palettes[preset];
        root.RequestedTheme = settings.Theme == ThemePreset.System ? ElementTheme.Default : palette.BaseTheme;
        var dark = palette.BaseTheme == ElementTheme.Dark;
        // Dark hierarchy: the window sits clearly below the cards, the border is a
        // low-contrast stroke (not a bright outline), and meta text is dimmer than
        // secondary text. Light themes keep their curated surfaces.
        var background = dark ? Scale(palette.Background, 0.78) : palette.Background;
        var border = dark ? Blend(palette.Card, palette.Hover, 0.5) : palette.Border;
        var track = dark ? Blend(palette.Card, palette.Hover, 0.65) : "#d5d6d1";
        var meta = dark ? Blend(palette.Secondary, background, 0.30) : Blend(palette.Secondary, palette.Card, 0.25);
        Set("AppBackgroundBrush", background);
        Set("CardBrush", palette.Card);
        Set("CardHoverBrush", palette.Hover);
        Set("CardBorderBrush", border);
        Set("PrimaryTextBrush", palette.Primary);
        Set("SecondaryTextBrush", palette.Secondary);
        Set("MetaTextBrush", meta);
        Set("TrackBrush", track);
        var accent = settings.Accent == AccentPreset.Custom
            ? settings.CustomAccent
            : Accents.GetValueOrDefault(settings.Accent, "#f97316");
        Set("AccentBrush", accent);
    }

    public static Color AccentColor(AppSettings settings)
    {
        var value = settings.Accent == AccentPreset.Custom
            ? settings.CustomAccent : Accents.GetValueOrDefault(settings.Accent, "#f97316");
        return Parse(value);
    }

    private static void Set(string key, string value)
    {
        var color = Parse(value);
        if (Application.Current.Resources[key] is SolidColorBrush brush)
        {
            if (!brush.Color.Equals(color))
                brush.Color = color;
        }
        else
            Application.Current.Resources[key] = new SolidColorBrush(color);
    }

    private static Color Parse(string value)
    {
        var clean = value.TrimStart('#');
        return Color.FromArgb(
            255,
            Convert.ToByte(clean[..2], 16),
            Convert.ToByte(clean.Substring(2, 2), 16),
            Convert.ToByte(clean.Substring(4, 2), 16));
    }

    // Multiply each channel toward black (factor < 1) or white (factor > 1).
    private static string Scale(string hex, double factor)
    {
        var color = Parse(hex);
        return Format(color.R * factor, color.G * factor, color.B * factor);
    }

    // Linear blend from `from` toward `to`.
    private static string Blend(string from, string to, double amount)
    {
        var a = Parse(from);
        var b = Parse(to);
        return Format(
            a.R + (b.R - a.R) * amount,
            a.G + (b.G - a.G) * amount,
            a.B + (b.B - a.B) * amount);
    }

    private static string Format(double red, double green, double blue) =>
        $"#{Channel(red):X2}{Channel(green):X2}{Channel(blue):X2}";

    private static byte Channel(double value) =>
        (byte)Math.Clamp((int)Math.Round(value, MidpointRounding.AwayFromZero), 0, 255);
}

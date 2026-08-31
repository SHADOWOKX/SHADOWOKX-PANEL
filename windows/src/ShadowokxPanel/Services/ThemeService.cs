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
            [ThemePreset.Shadow] = new("#252623", "#30312f", "#383936", "#464742", "#f5f3ed", "#b6b4ac", ElementTheme.Dark),
            [ThemePreset.Midnight] = new("#151820", "#1d222d", "#252b37", "#343b49", "#f4f7fb", "#9da8b8", ElementTheme.Dark),
            [ThemePreset.Graphite] = new("#15171a", "#1f2226", "#292d32", "#343941", "#f5f6f7", "#a5abb3", ElementTheme.Dark),
            [ThemePreset.Nord] = new("#242933", "#2e3440", "#3b4252", "#4c566a", "#eceff4", "#b6c0d1", ElementTheme.Dark),
            [ThemePreset.Amoled] = new("#000000", "#0c0c0d", "#171719", "#262629", "#ffffff", "#a9a9ae", ElementTheme.Dark),
            [ThemePreset.Light] = new("#e4e5e3", "#f5f5f2", "#ffffff", "#d1d2cd", "#242523", "#696d68", ElementTheme.Light),
        };

    private static readonly IReadOnlyDictionary<AccentPreset, string> Accents =
        new Dictionary<AccentPreset, string>
        {
            [AccentPreset.Rose] = "#f43f5e", [AccentPreset.Orange] = "#f97316",
            [AccentPreset.Emerald] = "#10b981", [AccentPreset.Cyan] = "#06b6d4",
            [AccentPreset.Blue] = "#3b82f6", [AccentPreset.Violet] = "#8b5cf6",
            [AccentPreset.Amber] = "#f59e0b", [AccentPreset.Monochrome] = "#94a3b8",
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
        Set("AppBackgroundBrush", palette.Background);
        Set("CardBrush", palette.Card);
        Set("CardHoverBrush", palette.Hover);
        Set("CardBorderBrush", palette.Border);
        Set("PrimaryTextBrush", palette.Primary);
        Set("SecondaryTextBrush", palette.Secondary);
        Set("TrackBrush", preset == ThemePreset.Light ? "#d5d6d1" : "#4d4e49");
        var accent = settings.Accent == AccentPreset.Custom
            ? settings.CustomAccent
            : Accents.GetValueOrDefault(settings.Accent, "#f43f5e");
        Set("AccentBrush", accent);
    }

    public static Color AccentColor(AppSettings settings)
    {
        var value = settings.Accent == AccentPreset.Custom
            ? settings.CustomAccent : Accents.GetValueOrDefault(settings.Accent, "#f43f5e");
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
}

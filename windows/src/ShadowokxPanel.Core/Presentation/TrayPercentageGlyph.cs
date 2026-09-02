namespace ShadowokxPanel.Core.Presentation;

public readonly record struct TrayGlyphPixel(int X, int Y);

public sealed record TrayPercentageGlyph(
    string AccessibleText,
    int Width,
    int Height,
    IReadOnlyList<TrayGlyphPixel> Pixels);

public static class TrayPercentageGlyphFactory
{
    private const int GlyphHeight = 5;
    private static readonly IReadOnlyDictionary<char, string[]> Glyphs =
        new Dictionary<char, string[]>
        {
            ['0'] = ["111", "101", "101", "101", "111"],
            ['1'] = ["010", "110", "010", "010", "111"],
            ['2'] = ["111", "001", "111", "100", "111"],
            ['3'] = ["111", "001", "111", "001", "111"],
            ['4'] = ["101", "101", "111", "001", "001"],
            ['5'] = ["111", "100", "111", "001", "111"],
            ['6'] = ["111", "100", "111", "101", "111"],
            ['7'] = ["111", "001", "010", "010", "010"],
            ['8'] = ["111", "101", "111", "101", "111"],
            ['9'] = ["111", "101", "111", "001", "111"],
        };

    // A compact neutral mark used until Codex reports a real percentage.
    private static readonly string[] UnavailableGlyph =
        ["01110", "10001", "00110", "00000", "00100"];

    public static TrayPercentageGlyph Create(int? remainingPercent)
    {
        if (!remainingPercent.HasValue)
            return FromRows("Codex usage unavailable", UnavailableGlyph);

        var normalized = Math.Clamp(remainingPercent.Value, 0, 100);
        // The tray tooltip carries the percent sign. Rendering only the digits lets the
        // percentage use the full 16 px notification-area canvas instead of becoming
        // unreadably narrow at common DPI settings.
        var text = normalized.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var rows = new string[GlyphHeight];
        for (var row = 0; row < GlyphHeight; row++)
            rows[row] = string.Join('0', text.Select(character => Glyphs[character][row]));

        return FromRows($"{normalized}% remaining", rows);
    }

    private static TrayPercentageGlyph FromRows(
        string accessibleText,
        IReadOnlyList<string> rows)
    {
        var pixels = new List<TrayGlyphPixel>();
        for (var y = 0; y < rows.Count; y++)
        {
            for (var x = 0; x < rows[y].Length; x++)
            {
                if (rows[y][x] == '1')
                    pixels.Add(new TrayGlyphPixel(x, y));
            }
        }
        return new TrayPercentageGlyph(accessibleText, rows[0].Length, rows.Count, pixels);
    }
}

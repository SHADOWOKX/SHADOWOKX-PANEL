namespace ShadowokxPanel.Core.Presentation;

public enum TrayGlyphTone
{
    Neutral,
    Healthy,
    Balanced,
    Warning,
}

public readonly record struct TrayGlyphPixel(int X, int Y);

public sealed record TrayPercentageGlyph(
    string AccessibleText,
    int Width,
    int Height,
    TrayGlyphTone Tone,
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
            ['%'] = ["101", "001", "010", "100", "101"],
        };

    // A compact neutral mark used until Codex reports a real percentage.
    private static readonly string[] UnavailableGlyph =
        ["01110", "10001", "00110", "00000", "00100"];

    public static TrayPercentageGlyph Create(int? remainingPercent, bool useCapacityColors)
    {
        if (!remainingPercent.HasValue)
            return FromRows("Codex usage unavailable", UnavailableGlyph, TrayGlyphTone.Neutral);

        var normalized = Math.Clamp(remainingPercent.Value, 0, 100);
        var text = $"{normalized}%";
        var rows = new string[GlyphHeight];
        for (var row = 0; row < GlyphHeight; row++)
            rows[row] = string.Join('0', text.Select(character => Glyphs[character][row]));

        var tone = useCapacityColors
            ? normalized switch
            {
                >= 60 => TrayGlyphTone.Healthy,
                >= 30 => TrayGlyphTone.Balanced,
                _ => TrayGlyphTone.Warning,
            }
            : TrayGlyphTone.Neutral;
        return FromRows($"{normalized}% remaining", rows, tone);
    }

    private static TrayPercentageGlyph FromRows(
        string accessibleText,
        IReadOnlyList<string> rows,
        TrayGlyphTone tone)
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
        return new TrayPercentageGlyph(accessibleText, rows[0].Length, rows.Count, tone, pixels);
    }
}

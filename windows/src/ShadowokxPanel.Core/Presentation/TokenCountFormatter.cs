using System.Globalization;

namespace ShadowokxPanel.Core.Presentation;

public static class TokenCountFormatter
{
    public static string Format(long tokens, CultureInfo culture)
    {
        ArgumentNullException.ThrowIfNull(culture);

        return tokens switch
        {
            >= 1_000_000_000 => $"{(tokens / 1_000_000_000d).ToString("0.#", culture)}B",
            >= 1_000_000 => $"{(tokens / 1_000_000d).ToString("0.#", culture)}M",
            >= 1_000 => $"{(tokens / 1_000d).ToString("0.#", culture)}K",
            _ => tokens.ToString("N0", culture),
        };
    }
}

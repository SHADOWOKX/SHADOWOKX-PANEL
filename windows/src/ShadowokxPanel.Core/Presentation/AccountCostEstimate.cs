using System.Globalization;
using ShadowokxPanel.Core.Codex;
using ShadowokxPanel.Core.Settings;

namespace ShadowokxPanel.Core.Presentation;

// A user-selected pricing scenario, not a reconstruction of missing account breakdowns.
public static class AccountCostEstimate
{
    public static decimal? Calculate(long? tokens, AppSettings settings)
    {
        if (tokens is null or < 0 || ApiPriceCatalog.Find(settings.EstimateModel) is not { } price)
            return null;
        var cached = settings.EstimateCachedPercent;
        var output = settings.EstimateOutputPercent;
        var writes = settings.EstimateWritePercent;
        if (cached < 0 || output < 0 || writes < 0 || (long)cached + output + writes > 100)
            return null;
        var input = 100 - cached - output - writes;
        var rate = (input * price.Rate(settings.EstimateLongContext, 0) +
            cached * price.Rate(settings.EstimateLongContext, 1) +
            output * price.Rate(settings.EstimateLongContext, 2) +
            writes * price.Rate(settings.EstimateLongContext, 3)) / 100;
        return tokens.Value / 1_000_000m * rate;
    }

    public static string Format(long? tokens, AppSettings settings, CultureInfo culture)
    {
        if (tokens is null or < 0) return "Not reported";
        var count = $"{TokenCountFormatter.Format(tokens.Value, culture)} tokens";
        if (!settings.ShowCostEstimate) return count;
        var amount = Calculate(tokens, settings);
        if (amount is null) return $"Estimate unavailable · {count}";
        var money = amount is > 0 and < .01m ? "<$0.01" : amount.Value.ToString("$#,##0.00", CultureInfo.InvariantCulture);
        return $"≈{money} · {count}";
    }
}

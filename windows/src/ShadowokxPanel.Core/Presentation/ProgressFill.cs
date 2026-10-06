namespace ShadowokxPanel.Core.Presentation;

public readonly record struct ProgressGeometry(double Value, double Start, double UsableWidth, long FillWidth);

// One shared fill calculation for every progress meter, so the displayed
// percentage and the visible fill always derive from the same canonical value.
public static class ProgressFill
{
    public static ProgressGeometry Geometry(double percent, double trackWidth, double startInset = 0, double endInset = 0)
    {
        var value = double.IsFinite(percent) ? Math.Max(0, Math.Min(100, percent)) : 0;
        var width = double.IsFinite(trackWidth) ? Math.Max(0, trackWidth) : 0;
        var start = double.IsFinite(startInset) ? Math.Max(0, startInset) : 0;
        var end = double.IsFinite(endInset) ? Math.Max(0, endInset) : 0;
        var usable = Math.Max(0, width - start - end);
        return new(value, start, usable, (long)Math.Round(usable * value / 100, MidpointRounding.AwayFromZero));
    }
}

// Remaining percentages are the single canonical value shown as text and consumed
// as the progress fill. Thresholds and colors come from UsageAnalytics, which uses
// the same red → orange → amber → green scale as Linux.
public static class AllowanceStatus
{
    public static double? Remaining(double? usedPercent) =>
        usedPercent is { } used && double.IsFinite(used)
            ? Math.Max(0, Math.Min(100, Math.Round(100 - used, MidpointRounding.AwayFromZero)))
            : null;
}

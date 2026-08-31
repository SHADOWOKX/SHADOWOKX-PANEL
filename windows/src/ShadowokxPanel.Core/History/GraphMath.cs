using ShadowokxPanel.Core.Models;

namespace ShadowokxPanel.Core.History;

public static class GraphMath
{
    public static IReadOnlyList<GraphPoint> Calculate(
        IEnumerable<UsageBucket>? values,
        double width,
        double height,
        double horizontalPadding = 6,
        double verticalPadding = 6)
    {
        if (!double.IsFinite(width) || !double.IsFinite(height) ||
            width <= horizontalPadding * 2 || height <= verticalPadding * 2)
            return [];
        var buckets = (values ?? [])
            .Where(bucket => bucket.Tokens >= 0)
            .GroupBy(bucket => bucket.Date)
            .Select(group => group.Last())
            .OrderBy(bucket => bucket.Date)
            .TakeLast(7)
            .ToArray();
        if (buckets.Length < 2)
            return [];
        var first = buckets[0].Date.DayNumber;
        var span = Math.Max(1, buckets[^1].Date.DayNumber - first);
        var maximum = buckets.Max(bucket => bucket.Tokens);
        var drawableWidth = width - horizontalPadding * 2;
        var drawableHeight = height - verticalPadding * 2;
        return buckets.Select(bucket =>
        {
            var position = (double)(bucket.Date.DayNumber - first) / span;
            return new GraphPoint(
                bucket.Date,
                bucket.Tokens,
                horizontalPadding + position * drawableWidth,
                maximum > 0
                    ? verticalPadding + (1 - (double)bucket.Tokens / maximum) * drawableHeight
                    : verticalPadding + drawableHeight,
                position);
        }).ToArray();
    }
}

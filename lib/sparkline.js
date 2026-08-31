const DAY_MS = 86_400_000;

function dayOrdinal(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return null;
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
        ? Math.floor(timestamp / DAY_MS)
        : null;
}

export function normalizeSparklineBuckets(buckets, maximum = 7) {
    if (!Array.isArray(buckets))
        return [];
    const limit = Number.isSafeInteger(maximum) && maximum >= 2 ? maximum : 7;
    const byDate = new Map();
    for (const bucket of buckets) {
        const ordinal = dayOrdinal(bucket?.date);
        if (ordinal === null || !Number.isSafeInteger(bucket?.tokens) || bucket.tokens < 0)
            continue;
        byDate.set(bucket.date, {date: bucket.date, tokens: bucket.tokens, ordinal});
    }
    return [...byDate.values()]
        .sort((left, right) => left.ordinal - right.ordinal)
        .slice(-limit);
}

export function sparklineCoordinates(buckets, width, height, padding = 4) {
    const points = normalizeSparklineBuckets(buckets);
    const horizontalPadding = Number.isFinite(padding?.x) ? padding.x : padding;
    const verticalPadding = Number.isFinite(padding?.y) ? padding.y : padding;
    if (points.length < 2 || !Number.isFinite(width) || !Number.isFinite(height) ||
        !Number.isFinite(horizontalPadding) || !Number.isFinite(verticalPadding) ||
        horizontalPadding < 0 || verticalPadding < 0 ||
        width <= horizontalPadding * 2 || height <= verticalPadding * 2)
        return [];
    const firstDay = points[0].ordinal;
    const daySpan = Math.max(1, points.at(-1).ordinal - firstDay);
    const maximum = Math.max(...points.map(point => point.tokens));
    const drawableWidth = width - horizontalPadding * 2;
    const drawableHeight = height - verticalPadding * 2;
    return points.map(point => ({
        ...point,
        x: horizontalPadding + (point.ordinal - firstDay) / daySpan * drawableWidth,
        // Daily usage is absolute, so retain a truthful zero baseline rather
        // than exaggerating small differences with a truncated Y axis.
        y: maximum > 0
            ? verticalPadding + (1 - point.tokens / maximum) * drawableHeight
            : verticalPadding + drawableHeight,
    }));
}

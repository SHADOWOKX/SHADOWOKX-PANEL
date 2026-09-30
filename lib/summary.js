import {normalizeSparklineBuckets} from './sparkline.js';

export function codexRemainingSummary(state) {
    const window = state?.weekly ?? state?.fiveHour;
    return Number.isFinite(window?.remainingPercent)
        ? Math.max(0, Math.min(100, Math.round(window.remainingPercent)))
        : null;
}

function localDateKey(nowMs) {
    const date = new Date(nowMs);
    if (!Number.isFinite(date.getTime()))
        return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-` +
        String(date.getDate()).padStart(2, '0');
}

export function codexUsagePace(state, nowMs = Date.now()) {
    const today = localDateKey(nowMs);
    if (!today)
        return null;
    const completed = normalizeSparklineBuckets(state?.tokenUsage?.dailyBuckets)
        .filter(bucket => bucket.date < today)
        .slice(-7);
    if (completed.length < 4)
        return null;

    const latest = completed.at(-1);
    const baseline = completed.slice(0, -1);
    const average = baseline.reduce((total, bucket) => total + bucket.tokens, 0) /
        baseline.length;
    if (!(average > 0))
        return null;

    const ratio = latest.tokens / average;
    if (ratio >= 1.5) {
        return {
            key: 'high',
            label: 'Heavy recent usage',
            iconName: null,
            ratio,
            date: latest.date,
        };
    }
    if (ratio <= 0.5) {
        return {
            key: 'low',
            label: 'Quiet recent usage',
            iconName: 'weather-clear-night-symbolic',
            ratio,
            date: latest.date,
        };
    }
    return {
        key: 'normal',
        label: 'Normal recent usage',
        iconName: 'power-profile-balanced-symbolic',
        ratio,
        date: latest.date,
    };
}

export function codexUsageStatus(remainingPercent) {
    if (!Number.isFinite(remainingPercent))
        return null;
    const remaining = Math.max(0, Math.min(100, Math.round(remainingPercent)));
    if (remaining >= 60)
        return {emoji: '🟢', label: 'Comfortable'};
    if (remaining >= 30)
        return {emoji: '🟡', label: 'Steady'};
    if (remaining >= 15)
        return {emoji: '🟠', label: 'Limited'};
    return {emoji: '🔴', label: 'Low'};
}

export function weatherSummaryTemperature(state) {
    return Number.isFinite(state?.current?.temperature)
        ? Math.round(state.current.temperature)
        : null;
}

// One shared, continuous low-to-high allowance scale for all Codex surfaces.
export function codexLimitColor(remainingPercent) {
    if (!Number.isFinite(remainingPercent))
        return '#9ca3af';
    const remaining = Math.max(0, Math.min(100, remainingPercent));
    const stops = [[0, [239, 68, 68]], [15, [249, 115, 22]],
        [30, [245, 158, 11]], [60, [34, 197, 94]], [100, [34, 197, 94]]];
    const upper = stops.findIndex(([percent]) => percent >= remaining);
    if (upper === 0)
        return '#ef4444';
    const [low, from] = stops[upper - 1];
    const [high, to] = stops[upper];
    const fraction = (remaining - low) / (high - low);
    return '#' + from.map((value, i) => Math.round(value + (to[i] - value) * fraction)
        .toString(16).padStart(2, '0')).join('');
}

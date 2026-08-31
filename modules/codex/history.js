import {normalizeSparklineBuckets} from '../../lib/sparkline.js';
import {localUsageDateKey, recentUsageBuckets} from './normalize.js';

export const CODEX_HISTORY_VERSION = 1;

export function normalizeCodexHistory(value, nowMs = Date.now()) {
    const startedAt = value?.version === CODEX_HISTORY_VERSION &&
        Number.isFinite(value.startedAt) && value.startedAt > 0 &&
        value.startedAt <= nowMs + 5 * 60 * 1000
        ? value.startedAt
        : nowMs;
    const dailyBuckets = value?.version === CODEX_HISTORY_VERSION
        ? recentUsageBuckets(normalizeSparklineBuckets(value.dailyBuckets), nowMs)
        : [];
    return {version: CODEX_HISTORY_VERSION, startedAt, dailyBuckets};
}

export function mergeCodexHistory(value, liveUsage, nowMs = Date.now()) {
    const history = normalizeCodexHistory(value, nowMs);
    const today = localUsageDateKey(nowMs);
    const current = liveUsage?.dailyBuckets?.find(bucket => bucket.date === today);
    const dailyBuckets = current
        ? recentUsageBuckets(normalizeSparklineBuckets([
            ...history.dailyBuckets,
            {date: current.date, tokens: current.tokens},
        ]), nowMs)
        : history.dailyBuckets;
    return {...history, dailyBuckets};
}

export function applyCodexHistory(usage, value, nowMs = Date.now()) {
    const history = normalizeCodexHistory(value, nowMs);
    const dailyBuckets = history.dailyBuckets;
    const peak = dailyBuckets.reduce((result, bucket) =>
        !result || bucket.tokens > result.tokens ? bucket : result, null);
    const today = dailyBuckets.find(bucket => bucket.date === localUsageDateKey(nowMs));
    if (!usage && dailyBuckets.length === 0)
        return null;
    return {
        lifetimeTokens: usage?.lifetimeTokens ?? null,
        todayTokens: today?.tokens ?? usage?.todayTokens ?? null,
        peakDailyTokens: peak?.tokens ?? null,
        peakDate: peak?.date ?? null,
        peakHour: null,
        dailyBuckets,
        sevenDayTokens: dailyBuckets.length
            ? dailyBuckets.reduce((total, bucket) => total + bucket.tokens, 0)
            : null,
    };
}

export function withoutCodexHistory(usage) {
    if (!usage)
        return null;
    return {
        lifetimeTokens: usage.lifetimeTokens ?? null,
        todayTokens: usage.todayTokens ?? null,
        peakDailyTokens: null,
        peakDate: null,
        peakHour: null,
        dailyBuckets: [],
        sevenDayTokens: null,
    };
}

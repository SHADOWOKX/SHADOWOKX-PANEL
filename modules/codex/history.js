import {normalizeSparklineBuckets} from '../../lib/sparkline.js';
import {localUsageDateKey, recentUsageBuckets} from './normalize.js';

export const CODEX_HISTORY_VERSION = 2;

const LEGACY_CODEX_HISTORY_VERSION = 1;

function validTimestamp(value, nowMs) {
    return Number.isFinite(value) && value > 0 && value <= nowMs + 5 * 60 * 1000
        ? value
        : null;
}

function validLifetimeTokens(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function laggedBucketIncrement(historyBuckets, liveBuckets, today) {
    const liveByDate = new Map(normalizeSparklineBuckets(liveBuckets)
        .map(bucket => [bucket.date, bucket.tokens]));
    const previous = [...historyBuckets]
        .reverse()
        .find(bucket => bucket.date < today && liveByDate.has(bucket.date));
    if (!previous)
        return null;
    return Math.max(0, liveByDate.get(previous.date) - previous.tokens);
}

export function normalizeCodexHistory(value, nowMs = Date.now()) {
    const supported = value?.version === CODEX_HISTORY_VERSION ||
        value?.version === LEGACY_CODEX_HISTORY_VERSION;
    const startedAt = supported ? validTimestamp(value.startedAt, nowMs) ?? nowMs : nowMs;
    const dailyBuckets = supported
        ? recentUsageBuckets(normalizeSparklineBuckets(value.dailyBuckets), nowMs)
        : [];
    const lastObservedAt = value?.version === CODEX_HISTORY_VERSION
        ? validTimestamp(value.lastObservedAt, nowMs)
        : null;
    const lastLifetimeTokens = lastObservedAt !== null
        ? validLifetimeTokens(value.lastLifetimeTokens)
        : null;
    return {
        version: CODEX_HISTORY_VERSION,
        startedAt,
        lastObservedAt,
        lastLifetimeTokens,
        dailyBuckets,
    };
}

export function mergeCodexHistory(value, liveUsage, nowMs = Date.now()) {
    const history = normalizeCodexHistory(value, nowMs);
    const today = localUsageDateKey(nowMs);
    if (!today)
        return history;

    const lifetimeTokens = validLifetimeTokens(liveUsage?.lifetimeTokens);
    const existingToday = history.dailyBuckets.find(bucket => bucket.date === today);
    const reportedToday = liveUsage?.dailyBuckets?.find(bucket => bucket.date === today);
    let current = reportedToday
        ? {date: today, tokens: reportedToday.tokens}
        : null;

    if (!current && lifetimeTokens !== null) {
        let observedIncrement = null;
        if (history.lastLifetimeTokens !== null && lifetimeTokens >= history.lastLifetimeTokens) {
            observedIncrement = lifetimeTokens - history.lastLifetimeTokens;
        } else if (history.lastLifetimeTokens === null) {
            // Version 1 stored real daily buckets but not the lifetime baseline.
            // If Codex is still increasing its latest prior-day bucket, preserve
            // that frozen local day and attribute only the observed increase to
            // today. This migrates existing history without importing backfill.
            observedIncrement = laggedBucketIncrement(
                history.dailyBuckets,
                liveUsage?.dailyBuckets,
                today
            );
        }
        if (observedIncrement !== null) {
            current = {
                date: today,
                tokens: (existingToday?.tokens ?? 0) + observedIncrement,
            };
        }
    }

    const dailyBuckets = current
        ? recentUsageBuckets(normalizeSparklineBuckets([
            ...history.dailyBuckets,
            {date: current.date, tokens: current.tokens},
        ]), nowMs)
        : history.dailyBuckets;
    const historyChanged = JSON.stringify(dailyBuckets) !== JSON.stringify(history.dailyBuckets);
    const observationDayChanged = history.lastObservedAt !== null &&
        localUsageDateKey(history.lastObservedAt) !== today;
    const lifetimeChanged = lifetimeTokens !== null &&
        lifetimeTokens !== history.lastLifetimeTokens;
    const shouldStoreObservation = lifetimeTokens !== null &&
        (history.lastObservedAt === null || observationDayChanged || lifetimeChanged || historyChanged);
    return {
        ...history,
        lastObservedAt: shouldStoreObservation ? nowMs : history.lastObservedAt,
        lastLifetimeTokens: shouldStoreObservation
            ? lifetimeTokens
            : history.lastLifetimeTokens,
        dailyBuckets,
    };
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

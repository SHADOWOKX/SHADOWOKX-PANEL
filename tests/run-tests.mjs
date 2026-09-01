import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    BACKGROUND_CODEX_REFRESH_INTERVAL,
    MODULE_IDS,
    VISIBLE_CODEX_REFRESH_INTERVAL,
} from '../lib/constants.js';
import {
    clampPercent,
    formatCountdown,
    formatRelativeAge,
    formatResetDate,
    isHexColor,
} from '../lib/format.js';
import {chooseInitialModule} from '../lib/moduleConfig.js';
import {progressFillGeometry} from '../lib/progress.js';
import {
    normalizeSparklineBuckets,
    sparklineCoordinates,
    sparklineDayLabels,
} from '../lib/sparkline.js';
import {
    codexRemainingSummary,
    codexUsagePace,
    codexUsageStatus,
    weatherSummaryTemperature,
} from '../lib/summary.js';
import {
    localUsageDateKey,
    normalizeCachedRateLimits,
    normalizeAccountTokenUsage,
    normalizeRateLimits,
} from '../modules/codex/normalize.js';
import {codexExecutableCandidates, findCodexExecutable} from '../modules/codex/discovery.js';
import {
    applyCodexHistory,
    CODEX_HISTORY_VERSION,
    mergeCodexHistory,
    normalizeCodexHistory,
    withoutCodexHistory,
} from '../modules/codex/history.js';
import {CodexProvider} from '../modules/codex/provider.js';
import {exportCodexSummaryImage, resolveSharePalette} from '../modules/codex/shareImage.js';
import {
    normalizeWeather,
    normalizeWeatherQuery,
    weatherDisplayLocation,
    weatherCacheMatchesSettings,
    weatherCondition,
    weatherSearchQueries,
} from '../modules/weather/normalize.js';
import {WeatherProvider} from '../modules/weather/provider.js';
import {Observable} from '../services/observable.js';
import {Logger} from '../services/logger.js';
import {JsonStore} from '../services/jsonStore.js';
import {Scheduler} from '../services/scheduler.js';

if (GLib.getenv('SHADOW_PANEL_TEST_ISOLATED') !== '1')
    throw new Error('Refusing to run persistence tests without an isolated XDG environment');

let assertions = 0;

function equal(actual, expected, message) {
    assertions++;
    if (actual !== expected)
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function ok(value, message) {
    assertions++;
    if (!value)
        throw new Error(message);
}

function rejects(callback, message) {
    assertions++;
    try {
        callback();
    } catch {
        return;
    }
    throw new Error(message);
}

async function rejectsAsync(callback, message) {
    assertions++;
    try {
        await callback();
    } catch {
        return;
    }
    throw new Error(message);
}

function waitMilliseconds(milliseconds) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

class FakeSettings {
    constructor(values = {}) {
        this.values = values;
        this.callbacks = new Map();
        this.nextId = 1;
    }

    get_int(key) {
        return this.values[key] ?? 15;
    }

    get_string(key) {
        return this.values[key] ?? '';
    }

    get_boolean(key) {
        return Boolean(this.values[key]);
    }

    connect(signal, callback) {
        const id = this.nextId++;
        this.callbacks.set(id, {signal, callback});
        return id;
    }

    disconnect(id) {
        this.callbacks.delete(id);
    }
}

const inertScheduler = {
    every() {},
    cancel() {},
};

class RecordingScheduler {
    constructor() {
        this.jobs = new Map();
        this.schedules = 0;
    }

    every(name, seconds, callback) {
        this.schedules++;
        this.jobs.set(name, {seconds, callback});
    }

    cancel(name) {
        this.jobs.delete(name);
    }

    run(name) {
        return this.jobs.get(name)?.callback();
    }
}

function testFormatting() {
    equal(clampPercent(112), 100, 'percent upper clamp');
    equal(clampPercent(-4), 0, 'percent lower clamp');
    equal(formatCountdown(4600, 1_000_000), 'Resets in 1h 0m', 'countdown formatting');
    equal(formatResetDate(Number.MAX_VALUE), 'Reset time unavailable', 'invalid reset dates are rejected');
    ok(isHexColor('#8b5cf6'), 'valid custom accent');
    ok(!isHexColor('purple'), 'invalid custom accent');
    equal(formatRelativeAge(999_970_000, 1_000_000_000), '30s ago',
        'sub-minute refresh ages update without provider work');
    equal(formatRelativeAge(999_880_000, 1_000_000_000), '2m ago',
        'minute refresh ages are formatted');
}

function testModuleConfiguration() {
    const pages = ['codex', 'weather'];
    equal(MODULE_IDS.join(','), pages.join(','), 'only Codex and Weather are registered');
    equal(chooseInitialModule(pages, true, 'weather', 'codex'), 'weather', 'last page wins');
    equal(chooseInitialModule(pages, false, 'weather', 'codex'), 'codex', 'default page wins');
    equal(chooseInitialModule(pages, true, 'removed', 'codex'), 'codex',
        'removed pages safely fall back to Codex');
}

function testSparklineData() {
    const normalized = normalizeSparklineBuckets([
        {date: '2026-08-30', tokens: 20},
        {date: 'invalid', tokens: 99},
        {date: '2026-02-31', tokens: 99},
        {date: '2026-08-28', tokens: 10},
        {date: '2026-08-30', tokens: 25},
        {date: '2026-08-29', tokens: -1},
    ]);
    equal(normalized.length, 2, 'sparkline rejects corrupt values and deduplicates dates');
    equal(normalized[0].date, '2026-08-28', 'sparkline points are chronological');
    equal(normalized[1].tokens, 25, 'the last valid duplicate daily bucket wins');
    const labels = sparklineDayLabels([
        {date: '2026-08-28', tokens: 10},
        {date: '2026-08-30', tokens: 25},
    ], 'en-US');
    equal(labels.length, 2, 'day labels exist only for real daily buckets');
    equal(labels[0].label, 'Aug 28',
        'two-point history uses an unambiguous compact real date');
    equal(labels[1].label, 'Aug 30',
        'the newest two-point label includes its real month and date');
    equal(labels.map(item => item.date).join(','), '2026-08-28,2026-08-30',
        'day labels preserve oldest-to-newest bucket order');
    equal(labels[0].position, 0, 'the oldest real label aligns with the first point');
    equal(labels[1].position, 1, 'the newest real label aligns with the final point');

    const missingDay = sparklineCoordinates([
        {date: '2026-08-28', tokens: 10},
        {date: '2026-08-30', tokens: 20},
    ], 100, 50);
    equal(Math.round(missingDay[0].x), 4, 'sparkline starts at the oldest real day');
    equal(Math.round(missingDay[1].x), 96, 'missing days remain an honest chronological gap');
    ok(missingDay.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)),
        'sparkline coordinates remain finite');
    const padded = sparklineCoordinates([
        {date: '2026-08-28', tokens: 10},
        {date: '2026-08-29', tokens: 20},
    ], 100, 50, 7);
    equal(padded.length, 2, 'exactly two real daily samples render a graph');
    equal(padded[0].x, 7, 'sparkline honors refined left drawing padding');
    equal(padded.at(-1).x, 93, 'sparkline honors refined right drawing padding');
    ok(padded.every(point => point.y >= 7 && point.y <= 43),
        'sparkline points remain inside refined vertical clipping bounds');
    const asymmetricPadding = sparklineCoordinates([
        {date: '2026-08-28', tokens: 10},
        {date: '2026-08-29', tokens: 20},
    ], 100, 48, {x: 8, y: 6});
    equal(asymmetricPadding[0].x, 8,
        'sparkline supports independent horizontal padding');
    equal(asymmetricPadding.at(-1).x, 92,
        'sparkline preserves the refined right inset');
    ok(asymmetricPadding.every(point => point.y >= 6 && point.y <= 42),
        'sparkline supports independent vertical clipping bounds');

    const allZero = sparklineCoordinates([
        {date: '2026-08-28', tokens: 0},
        {date: '2026-08-29', tokens: 0},
    ], 120, 54);
    equal(allZero[0].y, 50, 'all-zero history renders on the zero baseline');
    equal(sparklineCoordinates([{date: '2026-08-29', tokens: 4}], 120, 54).length, 0,
        'one point does not produce a meaningless chart');
    const spike = sparklineCoordinates([
        {date: '2026-08-28', tokens: 1},
        {date: '2026-08-29', tokens: Number.MAX_SAFE_INTEGER},
    ], 120, 54);
    ok(spike[0].y > spike[1].y, 'large spikes retain truthful zero-based scale');
    equal(normalizeSparklineBuckets(normalized, Number.NaN).length, 2,
        'invalid history limits cannot disable the storage bound');
}

function testProgressGeometry() {
    const trackWidth = 337;
    const startInset = 3;
    const endInset = 5;
    const usableWidth = 329;
    for (const [percent, expected] of [
        [0, 0],
        [2, 7],
        [10, 33],
        [50, 165],
        [98, 322],
        [100, 329],
    ]) {
        const geometry = progressFillGeometry(percent, trackWidth, startInset, endInset);
        equal(geometry.usableWidth, usableWidth,
            `${percent}% progress uses the measured content width`);
        equal(geometry.fillWidth, expected,
            `${percent}% progress has proportional allocation geometry`);
    }
    const nearlyFull = progressFillGeometry(98, trackWidth, startInset, endInset);
    equal(nearlyFull.usableWidth - nearlyFull.fillWidth, 7,
        '98% progress leaves only the rounded two-percent remainder');
    equal(progressFillGeometry(100, trackWidth, startInset, endInset).fillWidth, usableWidth,
        '100% progress reaches the exact usable track end');
    equal(progressFillGeometry(-1, trackWidth).value, 0,
        'progress values clamp only at the lower bound');
    equal(progressFillGeometry(101, trackWidth).value, 100,
        'progress values clamp only at the upper bound');
    equal(progressFillGeometry(98.5, 200).fillWidth, 197,
        'fractional progress retains proportional precision');
}

function testSchedulerLifecycle() {
    const scheduler = new Scheduler(null);
    scheduler.every('codex-refresh', 3600, () => null);
    scheduler.every('codex-refresh', 3600, () => null);
    equal(scheduler._sources.size, 1, 'rescheduling replaces the previous named timer');
    scheduler.every('weather-refresh', 3600, () => null);
    equal(scheduler._sources.size, 2, 'providers keep one timer each');
    scheduler.destroy();
    equal(scheduler._sources.size, 0, 'scheduler teardown removes every timer source');
}

function testCodexNormalization() {
    const nowMs = new Date(2026, 7, 29, 12).getTime();
    const state = normalizeRateLimits({
        rateLimits: {
            planType: 'plus',
            primary: {usedPercent: 68, windowDurationMins: 300, resetsAt: 2_000_000_000},
            secondary: {usedPercent: 43, windowDurationMins: 10080, resetsAt: 2_000_100_000},
            credits: {hasCredits: true, unlimited: false, balance: '12 credits'},
        },
        rateLimitResetCredits: {
            availableCount: 1,
            credits: [{status: 'available', title: 'Reset now', expiresAt: 2_100_000_000}],
        },
    }, nowMs, {
        usageResponse: {
            summary: {lifetimeTokens: 885_281_875, peakDailyTokens: 284_458_873},
            dailyUsageBuckets: [
                {startDate: '2026-08-09', tokens: 284_458_873},
                {startDate: '2026-08-29', tokens: 5_822_658},
            ],
        },
    });
    equal(state.fiveHour.usedPercent, 68, 'five-hour usage');
    equal(state.fiveHour.remainingPercent, 32, 'five-hour remaining');
    equal(state.weekly.usedPercent, 43, 'weekly usage');
    equal(state.resetCreditsAvailable, 1, 'reset-credit count is normalized');
    equal(state.tokenUsage.todayTokens, 5_822_658, 'today token usage is normalized');
    equal(state.tokenUsage.lifetimeTokens, 885_281_875, 'lifetime token usage is normalized');
    equal(state.tokenUsage.peakDate, '2026-08-09', 'peak token day keeps the real bucket date');
    equal(state.tokenUsage.peakHour, null, 'peak hour is not fabricated from daily buckets');
    equal(state.tokenUsage.dailyBuckets.length, 1,
        'only verified buckets from the current seven-day window are retained');
    equal(state.tokenUsage.sevenDayTokens, 5_822_658,
        'seven-day activity is derived from real daily buckets');
    equal(state.lastSuccessfulRefresh, nowMs, 'Codex refresh timestamp');

    const weeklyOnly = normalizeRateLimits({
        rateLimitsByLimitId: {
            codex: {primary: {usedPercent: 4, windowDurationMins: 10080, resetsAt: 2_000_000_000}},
        },
        rateLimits: {},
    });
    equal(weeklyOnly.fiveHour, null, 'missing five-hour remains unavailable');
    equal(weeklyOnly.weekly.usedPercent, 4, 'weekly-only response');
    rejects(() => normalizeRateLimits({
        rateLimits: {
            primary: {usedPercent: 4, windowDurationMins: 60, resetsAt: 2_000_000_000},
        },
    }), 'unrecognized rate-limit windows fail closed instead of showing misleading data');
    equal(normalizeCachedRateLimits({lastSuccessfulRefresh: Date.now()}), null,
        'semantically empty Codex caches are rejected');
    equal(normalizeCachedRateLimits({
        lastSuccessfulRefresh: Date.now() + 10 * 60 * 1000,
        weekly: {usedPercent: 1, resetsAt: 2_000_000_000},
    }), null, 'future Codex caches are rejected');
    equal(normalizeAccountTokenUsage({
        summary: {lifetimeTokens: Number.MAX_SAFE_INTEGER + 1},
        dailyUsageBuckets: [{startDate: 'invalid', tokens: 100}],
    }), null, 'unsafe or undated token activity is rejected');
    equal(normalizeAccountTokenUsage({summary: {lifetimeTokens: 123}}).sevenDayTokens, null,
        'a missing daily history never becomes a fabricated zero-token week');
    const directDailyUsage = normalizeAccountTokenUsage({
        summary: {lifetimeTokens: 10_000},
        dailyUsageBuckets: [
            {startDate: '2026-08-27', tokens: 100},
            {startDate: '2026-08-28', tokens: -4},
            {startDate: '2026-08-27', tokens: 125},
            {startDate: '2026-08-29', tokens: 200},
        ],
    }, nowMs);
    equal(directDailyUsage.dailyBuckets.length, 2,
        'daily activity rejects negative counters and deduplicates dates');
    equal(directDailyUsage.dailyBuckets[0].tokens, 125,
        'the newest valid value for a duplicate day is retained');
    equal(directDailyUsage.dailyBuckets[1].tokens, 200,
        'reported daily buckets remain direct values rather than lifetime deltas');
    equal(directDailyUsage.sevenDayTokens, 325,
        'seven-day activity sums only validated real daily buckets');
    const cachedUsage = normalizeCachedRateLimits({
        lastSuccessfulRefresh: Date.now(),
        weekly: {usedPercent: 10, resetsAt: 2_000_000_000},
        tokenUsage: {
            lifetimeTokens: 12_345,
            todayTokens: 678,
            peakDailyTokens: 9_000,
            peakDate: '2026-08-20',
        },
    });
    equal(cachedUsage.tokenUsage.todayTokens, 678,
        'validated token activity survives a cached refresh');
    equal(cachedUsage.tokenUsage.dailyBuckets.length, 0,
        'older caches without history remain compatible');
}

function testCodexPortability() {
    const home = '/srv/users/Name With Spaces';
    const data = '/srv/xdg data';
    const candidates = codexExecutableCandidates({
        homeDirectory: home,
        userDataDirectory: data,
        environment: {
            NVM_BIN: '/srv/node current/bin',
            VOLTA_HOME: '/srv/volta',
            BUN_INSTALL: null,
            PNPM_HOME: '/srv/pnpm',
            FNM_MULTISHELL_PATH: null,
        },
    });
    ok(candidates.includes('/srv/users/Name With Spaces/.local/bin/codex'),
        'Codex discovery uses the current home directory without assuming /home');
    ok(candidates.includes('/srv/xdg data/pnpm/codex'),
        'Codex discovery honors the current XDG data directory');
    ok(candidates.includes('/srv/node current/bin/codex'),
        'Codex discovery honors an exported current Node installation');
    equal(findCodexExecutable({
        homeDirectory: home,
        userDataDirectory: data,
        environment: {},
        pathLookup: () => '/custom/current-user/bin/codex',
        executableTest: path => path === '/custom/current-user/bin/codex',
    }), '/custom/current-user/bin/codex', 'the current GNOME environment PATH takes precedence');
    equal(findCodexExecutable({
        homeDirectory: home,
        userDataDirectory: data,
        environment: {},
        pathLookup: () => null,
        executableTest: () => false,
    }), null, 'a user without Codex is reported honestly');
}

function testCodexLocalHistory() {
    const aug31Ms = new Date(2026, 7, 31, 12).getTime();
    const sep1Ms = new Date(2026, 8, 1, 12).getTime();
    const sep2Ms = new Date(2026, 8, 2, 12).getTime();
    equal(localUsageDateKey(new Date(2026, 8, 1, 0, 0).getTime()), '2026-09-01',
        'history uses the local calendar day at midnight');
    equal(localUsageDateKey(new Date(2026, 8, 1, 0, 0).getTime() - 1), '2026-08-31',
        'the local day rolls over exactly at local midnight');

    const liveUsage = normalizeAccountTokenUsage({
        summary: {lifetimeTokens: 10_000},
        dailyUsageBuckets: [
            {startDate: '2026-08-29', tokens: 100},
            {startDate: '2026-08-30', tokens: 200},
            {startDate: '2026-08-31', tokens: 300},
        ],
    }, aug31Ms);
    const firstRun = mergeCodexHistory(null, liveUsage, aug31Ms);
    equal(firstRun.dailyBuckets.length, 1,
        'a fresh installation starts with only its first real current-day sample');
    equal(firstRun.dailyBuckets[0].date, '2026-08-31',
        'fresh history never imports earlier account-side buckets');
    equal(firstRun.version, CODEX_HISTORY_VERSION,
        'new history uses the current local aggregation schema');

    const existing = {
        version: 1,
        startedAt: aug31Ms - 86_400_000,
        dailyBuckets: [{date: '2026-08-30', tokens: 175}],
    };
    const merged = mergeCodexHistory(existing, liveUsage, aug31Ms);
    equal(merged.dailyBuckets.length, 2, 'existing local history gains one current-day sample');
    equal(mergeCodexHistory(merged, liveUsage, aug31Ms).dailyBuckets.length, 2,
        'repeated refreshes never duplicate a same-day history entry');
    const displayed = applyCodexHistory(liveUsage, merged, aug31Ms);
    equal(displayed.peakDailyTokens, 300, 'local peak statistics derive from local history');
    equal(displayed.sevenDayTokens, 475, 'local seven-day total derives from local history');
    equal(withoutCodexHistory(displayed).dailyBuckets.length, 0,
        'the current-limit cache never duplicates local graph history');

    const laggedSep1Usage = normalizeAccountTokenUsage({
        summary: {lifetimeTokens: 10_040},
        dailyUsageBuckets: [{startDate: '2026-08-31', tokens: 340}],
    }, sep1Ms);
    const rolled = mergeCodexHistory(firstRun, laggedSep1Usage, sep1Ms);
    equal(rolled.dailyBuckets.length, 2,
        'the next local day becomes graph-eligible on its first real sample');
    equal(rolled.dailyBuckets[0].tokens, 300,
        'local-day rollover freezes the previous real daily total');
    equal(rolled.dailyBuckets[1].date, '2026-09-01',
        'lifetime activity is assigned to the canonical current local day');
    equal(rolled.dailyBuckets[1].tokens, 40,
        'a lagging upstream date uses only the real observed lifetime increment');
    equal(sparklineCoordinates(rolled.dailyBuckets, 120, 48).length, 2,
        'the Aug 31 to Sep 1 two-point trend produces valid graph geometry');

    const laterSep1 = mergeCodexHistory(rolled, {
        lifetimeTokens: 10_065,
        dailyBuckets: [{date: '2026-08-31', tokens: 365}],
    }, sep1Ms + 60_000);
    equal(laterSep1.dailyBuckets.length, 2,
        'same-day adaptive refreshes replace rather than append history');
    equal(laterSep1.dailyBuckets.at(-1).tokens, 65,
        'same-day lifetime increments update the existing local daily total');
    const unchangedSep1 = mergeCodexHistory(laterSep1, {
        lifetimeTokens: 10_065,
        dailyBuckets: [{date: '2026-08-31', tokens: 365}],
    }, sep1Ms + 120_000);
    equal(JSON.stringify(unchangedSep1), JSON.stringify(laterSep1),
        'unchanged 30-second samples do not create history writes');

    const zeroRollover = mergeCodexHistory(laterSep1, {
        lifetimeTokens: 10_065,
        dailyBuckets: [{date: '2026-08-31', tokens: 365}],
    }, sep2Ms);
    equal(zeroRollover.dailyBuckets.at(-1).tokens, 0,
        'a real zero-activity rollover remains a valid daily sample');
    const thirdDay = mergeCodexHistory(zeroRollover, {
        lifetimeTokens: 10_080,
        dailyBuckets: [{date: '2026-08-31', tokens: 380}],
    }, sep2Ms + 60_000);
    equal(thirdDay.dailyBuckets.length, 3,
        'third and later local days continue the bounded daily series');
    equal(thirdDay.dailyBuckets.at(-1).tokens, 15,
        'the current local day continues accumulating real increments');

    const realWorldLegacy = {
        version: 1,
        startedAt: aug31Ms,
        dailyBuckets: [{date: '2026-08-31', tokens: 76_912_508}],
    };
    const realWorldUsage = {
        lifetimeTokens: 1_079_439_605,
        dailyBuckets: [{date: '2026-08-31', tokens: 172_516_170}],
    };
    const migrated = mergeCodexHistory(realWorldLegacy, realWorldUsage, sep1Ms);
    equal(migrated.dailyBuckets.map(bucket => bucket.date).join(','),
        '2026-08-31,2026-09-01',
        'the observed Aug 31 to Sep 1 case migrates without losing either day');
    equal(migrated.dailyBuckets.at(-1).tokens, 95_603_662,
        'legacy migration attributes only the provider bucket increase to Sep 1');
    const migratedDisplay = applyCodexHistory(realWorldUsage, migrated, sep1Ms);
    equal(migratedDisplay.peakDailyTokens, 95_603_662,
        'Peak is calculated from the same canonical daily series as the graph');
    equal(migratedDisplay.peakDate, '2026-09-01',
        'Peak day updates when the current real local total becomes highest');

    const bankedResetState = normalizeRateLimits({
        rateLimits: {
            primary: {
                usedPercent: 0,
                windowDurationMins: 10_080,
                resetsAt: 2_000_000_000,
            },
        },
        rateLimitResetCredits: {availableCount: 0, credits: []},
    }, sep1Ms + 180_000, {
        usageResponse: {
            summary: {lifetimeTokens: realWorldUsage.lifetimeTokens},
            dailyUsageBuckets: [{startDate: '2026-08-31', tokens: 172_516_170}],
        },
    });
    equal(bankedResetState.weekly.remainingPercent, 100,
        'a banked reset can truthfully restore weekly capacity');
    const bankedResetRefresh = mergeCodexHistory(
        migrated,
        bankedResetState.tokenUsage,
        sep1Ms + 180_000
    );
    equal(JSON.stringify(bankedResetRefresh.dailyBuckets), JSON.stringify(migrated.dailyBuckets),
        'weekly or banked-reset state cannot clear independent token history');
    const reloaded = normalizeCodexHistory(JSON.parse(JSON.stringify(migrated)), sep1Ms);
    equal(reloaded.dailyBuckets.length, 2,
        'disable and re-enable preserves the persisted graph-eligible history');
    equal(reloaded.dailyBuckets[0].tokens, 76_912_508,
        'version 1 migration preserves valid existing user history');

    equal(normalizeCodexHistory({
        version: 999,
        startedAt: 1,
        dailyBuckets: [{date: '2026-08-30', tokens: 999}],
    }, aug31Ms).dailyBuckets.length, 0, 'unsupported history formats fail closed');
}

function testTopBarSummaries() {
    equal(codexRemainingSummary({fiveHour: {remainingPercent: 89.4}, weekly: {remainingPercent: 60}}),
        60, 'Codex summary prefers the weekly remaining capacity');
    equal(codexRemainingSummary({fiveHour: {remainingPercent: 57}, weekly: null}),
        57, 'Codex summary falls back to five-hour remaining capacity');
    equal(codexUsageStatus(61).emoji, '🟢', 'comfortable usage status');
    equal(codexUsageStatus(29).emoji, '🟠', 'limited usage status');
    equal(codexUsageStatus(4).emoji, '🔴', 'low usage status');
    equal(weatherSummaryTemperature({current: {temperature: 33.6}}),
        34, 'weather summary rounds temperature');

    const paceState = tokens => ({
        tokenUsage: {
            dailyBuckets: tokens.map((value, index) => ({
                date: `2026-08-${String(27 + index).padStart(2, '0')}`,
                tokens: value,
            })),
        },
    });
    const nowMs = new Date(2026, 8, 1, 12).getTime();
    equal(codexUsagePace(paceState([100, 100, 100, 200]), nowMs).key,
        'high', 'usage state flags a completed day at least 1.5× its real baseline');
    equal(codexUsagePace(paceState([100, 100, 100, 120]), nowMs).key,
        'normal', 'usage state keeps ordinary completed-day activity neutral');
    equal(codexUsagePace(paceState([100, 100, 100, 40]), nowMs).key,
        'low', 'usage state flags a completed day at most half its real baseline');
    equal(codexUsagePace(paceState([100, 100, 100]), nowMs), null,
        'usage state stays hidden without four completed daily buckets');
    equal(codexUsagePace(paceState([0, 0, 0, 100]), nowMs), null,
        'usage state does not guess from a zero baseline');
    equal(codexUsagePace(paceState([100, 100, 100, 10]),
        new Date(2026, 7, 30, 12).getTime()), null,
        'today\'s incomplete bucket is excluded instead of being labeled quiet');
}

function testWeatherNormalization() {
    const currentTime = 2_000_000_000;
    const payload = {
        timezone: 'Africa/Cairo',
        current: {
            time: currentTime,
            temperature_2m: 29.4,
            apparent_temperature: 31.2,
            relative_humidity_2m: 48,
            weather_code: 0,
            wind_speed_10m: 12.1,
        },
        daily: {
            temperature_2m_max: [33],
            temperature_2m_min: [22],
            uv_index_max: [7.2],
            sunrise: [currentTime - 6 * 3600],
            sunset: [currentTime + 6 * 3600],
        },
        hourly: {
            time: [currentTime - 3600, currentTime, currentTime + 3600],
            temperature_2m: [30, 29, 28],
            weather_code: [0, 1, 2],
            precipitation_probability: [0, 12, 27],
        },
    };
    const state = normalizeWeather(payload, 'Cairo, Egypt', 'celsius', 1000);
    equal(state.current.condition.label, 'Clear sky', 'weather condition');
    equal(state.forecast.length, 2, 'past forecast hours removed');
    equal(state.today.high, 33, 'daily high');
    equal(state.today.uv, 7.2, 'daily UV index');
    equal(state.current.rainProbability, 12, 'current rain chance uses the next forecast hour');
    equal(state.forecast[1].precipitationChance, 27, 'hourly rain chance is normalized');
    const withoutUv = normalizeWeather({
        ...payload,
        daily: {...payload.daily, uv_index_max: []},
    }, 'Cairo, Egypt', 'celsius', 1000);
    equal(withoutUv.today.uv, null,
        'missing UV data remains absent instead of becoming a fabricated zero');
    const withoutHourly = normalizeWeather({
        ...payload,
        hourly: undefined,
    }, 'Cairo, Egypt', 'celsius', 1000);
    equal(withoutHourly.forecast.length, 0,
        'missing hourly data leaves the main Weather page usable');
    equal(withoutHourly.current.rainProbability, null,
        'missing hourly precipitation remains absent instead of becoming zero');
    const nullOptionals = normalizeWeather({
        ...payload,
        daily: {...payload.daily, uv_index_max: [null]},
        hourly: {...payload.hourly, precipitation_probability: [null, null, null]},
    }, 'Cairo, Egypt', 'celsius', 1000);
    equal(nullOptionals.today.uv, null,
        'null UV data remains absent instead of becoming a fabricated zero');
    equal(nullOptionals.current.rainProbability, null,
        'null precipitation remains absent instead of becoming a fabricated zero');
    rejects(() => normalizeWeather({
        ...payload,
        daily: {...payload.daily, temperature_2m_max: [null]},
    }, 'Cairo, Egypt', 'celsius', 1000),
    'null required temperatures are rejected instead of becoming zero');
    equal(weatherCondition(999).label, 'Unknown conditions', 'unknown weather code');
    equal(weatherCondition('__proto__').label, 'Unknown conditions',
        'prototype names cannot become weather conditions');
    for (const code of [56, 57, 66, 67, 77, 85, 86])
        ok(weatherCondition(code).label !== 'Unknown conditions', `WMO code ${code} is mapped`);
    equal(normalizeWeatherQuery('  Cairo\n\u202e Egypt  '), 'Cairo Egypt',
        'weather queries remove controls and normalize whitespace');
    equal(normalizeWeatherQuery('  port-said , Egypt  '), 'port-said, Egypt',
        'weather queries normalize comma spacing');
    equal(weatherSearchQueries('port-said , Egypt').join('|'),
        'port-said, Egypt|port said, Egypt',
        'hyphenated places get a safe relaxed fallback query');
    equal(weatherDisplayLocation('Port Said, Port Said Governorate, Egypt'),
        'Port Said, Egypt', 'Weather presentation omits redundant administrative detail');
    equal(weatherDisplayLocation('Cairo, Egypt'), 'Cairo, Egypt',
        'short Weather locations remain unchanged');
    const longQuery = normalizeWeatherQuery('😀'.repeat(121));
    equal([...longQuery].length, 120, 'weather query length is capped by Unicode code point');
    ok(Boolean(encodeURIComponent(longQuery)), 'weather query truncation preserves valid Unicode');
    const cached = {
        state,
        resolvedLocation: {
            query: 'Cairo, Egypt',
            latitude: 30.04,
            longitude: 31.24,
            displayName: 'Cairo, Egypt',
        },
    };
    ok(weatherCacheMatchesSettings(cached, 'Cairo, Egypt', 'celsius'),
        'matching Weather cache is accepted');
    ok(!weatherCacheMatchesSettings(cached, 'Alexandria, Egypt', 'celsius'),
        'Weather cache from another location is rejected');
    ok(!weatherCacheMatchesSettings(cached, 'Cairo, Egypt', 'fahrenheit'),
        'Weather cache from another unit is rejected');
}

function testExtendedWeatherForecast() {
    const currentTime = 2_000_000_000;
    const hours = Array.from({length: 20}, (_value, index) => currentTime + index * 3600);
    const payload = {
        timezone: 'Africa/Cairo',
        current: {
            time: currentTime,
            temperature_2m: 29,
            apparent_temperature: 30,
            relative_humidity_2m: 45,
            weather_code: 0,
            wind_speed_10m: 10,
        },
        daily: {
            temperature_2m_max: [33],
            temperature_2m_min: [22],
            uv_index_max: [6],
            sunrise: [currentTime - 6 * 3600],
            sunset: [currentTime + 6 * 3600],
        },
        hourly: {
            time: hours,
            temperature_2m: hours.map((_time, index) => 29 - index / 2),
            weather_code: hours.map(() => 0),
            precipitation_probability: hours.map((_time, index) => index),
        },
    };
    const state = normalizeWeather(payload, 'Cairo, Egypt', 'celsius', currentTime * 1000);
    equal(state.forecast.length, 12, 'Weather retains a bounded scrollable hourly forecast');
    equal(state.forecast[11].precipitationChance, 11,
        'extended hourly precipitation remains normalized');
}

async function testWeatherLocationFallback() {
    const provider = new WeatherProvider(new FakeSettings({
        'weather-refresh-minutes': 30,
        'weather-location': 'port-said , Egypt',
        'weather-unit': 'celsius',
    }), inertScheduler, null);
    const requests = [];
    provider._getJson = async url => {
        requests.push(url);
        if (requests.length === 1)
            return {};
        return {results: [{
            name: 'Port Said',
            admin1: 'Port Said',
            country: 'Egypt',
            latitude: 31.2565,
            longitude: 32.2841,
        }]};
    };
    const location = await provider._resolveLocation(provider._locationQuery(), null);
    equal(requests.length, 2, 'Weather retries a hyphenated city with spaces');
    ok(requests[1].includes('port%20said%2C%20Egypt'),
        'Weather fallback keeps the country qualifier');
    equal(location.query, 'port-said, Egypt',
        'Weather caches against the normalized user query');
    equal(location.displayName, 'Port Said, Egypt',
        'Weather removes duplicate administrative labels');
    equal(provider._friendlyError(new Error('weather-location-not-found')),
        'Location not found. Try “City, Country” without abbreviations.',
        'missing locations get an actionable error');
    provider.destroy();
}

function testContentValidation() {
    const observable = new Observable({ready: true});
    let callbackCount = 0;
    rejects(() => observable.subscribe(() => {
        callbackCount++;
        throw new Error('broken initial listener');
    }), 'initial observable listener failures propagate');
    observable._setState({ready: false});
    equal(callbackCount, 1, 'failed initial observable listener is removed');
    const logger = new Logger(new FakeSettings({debug: true}));
    const deeplyNested = {one: {two: {three: {four: {five: {six: {token: 'secret'}}}}}}};
    equal(logger._sanitize(deeplyNested).one.two.three.four.five.six, '[max-depth]',
        'logger depth limits never return raw nested objects');
    equal(logger._sanitize(12n), '12', 'logger safely normalizes BigInt values');
}

async function testCodexShareImage() {
    const outputDirectory = GLib.build_filenamev([GLib.get_user_data_dir(), 'share-images']);
    const state = {
        status: 'success',
        accountName: 'shadow',
        planLabel: 'Codex Plus',
        weekly: {
            remainingPercent: 57,
            usedPercent: 43,
            resetsAt: 2_000_100_000,
        },
        fiveHour: null,
        resetCreditsAvailable: 1,
        clientVersion: '0.150.0-alpha.12.2',
        lastSuccessfulRefresh: 1_999_999_000_000,
    };
    const options = {
        outputDirectory,
        nowMs: 1_999_999_000_000,
        accent: '#8b5cf6',
        backgroundTheme: 'claude-gray',
        interfaceTheme: 'dark',
    };
    const first = await exportCodexSummaryImage(state, options);
    const second = await exportCodexSummaryImage(state, options);
    ok(first.path !== second.path, 'share images never overwrite an existing export');
    const [loaded, contents] = GLib.file_get_contents(first.path);
    ok(loaded, 'Codex summary image was written');
    equal([...contents.slice(0, 8)].join(','), '137,80,78,71,13,10,26,10',
        'Codex summary export is a PNG image');
    const info = Gio.File.new_for_path(first.path).query_info(
        'unix::mode', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    equal(info.get_attribute_uint32('unix::mode') & 0o077, 0,
        'Codex summary image is private from creation through export');
    equal(resolveSharePalette('graphite', 'dark').card, '#1f2226',
        'Graphite share palette matches the panel background');
    equal(resolveSharePalette('gnome', 'light').text, '#222326',
        'GNOME share palette follows the effective interface theme');
    await rejectsAsync(() => exportCodexSummaryImage({weekly: {remainingPercent: NaN}}, options),
        'malformed usage windows are rejected before image rendering');
}

async function testProviderFailureIsolation() {
    const codex = new CodexProvider(
        new FakeSettings({'codex-refresh-minutes': 15}),
        inertScheduler,
        null
    );
    codex._readAppServer = async () => ({
        initializeResponse: {userAgent: 'codex-cli/1.2.3'},
        accountResponse: {account: {planType: 'plus'}},
        rateLimitsResponse: {
            rateLimits: {
                primary: {usedPercent: 20, windowDurationMins: 10080, resetsAt: 2_000_000_000},
            },
        },
    });
    codex._cache.write = async () => {
        throw new Error('cache unavailable');
    };
    const codexState = await codex.refresh(true);
    equal(codexState.status, 'success', 'Codex live data survives a cache-write failure');
    codex.destroy();

    const unsupported = new CodexProvider(
        new FakeSettings({'codex-refresh-minutes': 15}),
        inertScheduler,
        null
    );
    unsupported._readAppServer = async () => ({rateLimitsResponse: {unexpected: true}});
    const unsupportedState = await unsupported.refresh(true);
    equal(unsupportedState.status, 'error', 'unsupported Codex data fails gracefully');
    equal(unsupportedState.errorCode, 'unsupported-response',
        'unsupported Codex data is distinguished without guessing limits');
    unsupported.destroy();

    const weatherSettings = new FakeSettings({
        'weather-refresh-minutes': 30,
        'weather-location': 'Cairo, Egypt',
        'weather-unit': 'celsius',
    });
    const weather = new WeatherProvider(weatherSettings, inertScheduler, null);
    const currentTime = Math.floor(Date.now() / 1000);
    weather._resolveLocation = async query => ({
        query,
        latitude: 30,
        longitude: 31,
        displayName: query,
    });
    weather._fetchForecast = async () => ({
        timezone: 'Africa/Cairo',
        current: {
            time: currentTime,
            temperature_2m: 29,
            apparent_temperature: 30,
            relative_humidity_2m: 45,
            weather_code: 0,
            wind_speed_10m: 10,
        },
        daily: {
            temperature_2m_max: [33],
            temperature_2m_min: [22],
            uv_index_max: [6],
            sunrise: [currentTime - 6 * 3600],
            sunset: [currentTime + 6 * 3600],
        },
        hourly: {
            time: [currentTime],
            temperature_2m: [29],
            weather_code: [0],
            precipitation_probability: [0],
        },
    });
    weather._cache.write = async () => {
        throw new Error('cache unavailable');
    };
    const weatherState = await weather.refresh(true);
    equal(weatherState.status, 'success', 'Weather live data survives a cache-write failure');
    weather._resolveLocation = async () => {
        throw new Error('network unavailable');
    };
    const cachedWeather = await weather.refresh(true);
    equal(cachedWeather.status, 'stale', 'failed Weather refresh keeps the last valid state');
    equal(cachedWeather.current.temperature, 29,
        'failed Weather refresh never replaces the last valid temperature');
    weather.destroy();
}

async function testPersistenceAndRefreshCoalescing() {
    const cacheDirectory = GLib.build_filenamev([GLib.get_user_cache_dir(), 'corrupt-cache-test']);
    GLib.mkdir_with_parents(cacheDirectory, 0o700);
    GLib.file_set_contents(GLib.build_filenamev([cacheDirectory, 'state.json']), '{broken json');
    const store = new JsonStore(cacheDirectory, 'state.json', null, 4096);
    const fallback = {safe: true};
    equal((await store.read(fallback)).safe, true,
        'corrupt JSON caches fall back without crashing');
    const firstRunDirectory = GLib.build_filenamev([
        GLib.get_user_data_dir(),
        `first-run-store-${GLib.uuid_string_random()}`,
    ]);
    const firstRunStore = new JsonStore(firstRunDirectory, 'state.json', null, 4096);
    await firstRunStore.write({ready: true});
    const directoryInfo = Gio.File.new_for_path(firstRunDirectory).query_info(
        'unix::mode', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    equal(directoryInfo.get_attribute_uint32('unix::mode') & 0o077, 0,
        'first-run storage directory is private');
    equal((await firstRunStore.read(null)).ready, true,
        'first-run storage creates and reads its file without manual setup');

    const dates = Array.from({length: 10}, (_value, index) => ({
        date: `2026-08-${String(index + 1).padStart(2, '0')}`,
        tokens: index + 1,
    }));
    const cached = normalizeCachedRateLimits({
        lastSuccessfulRefresh: Date.now(),
        weekly: {usedPercent: 10, resetsAt: 2_000_000_000},
        tokenUsage: {
            lifetimeTokens: 100,
            dailyBuckets: [...dates, {...dates.at(-1), tokens: 99}],
        },
    });
    equal(cached.tokenUsage.dailyBuckets.length, 7,
        'cached token history remains bounded to seven daily buckets');
    equal(cached.tokenUsage.dailyBuckets[0].date, '2026-08-04',
        'history bounds retain the newest chronological days');
    equal(cached.tokenUsage.dailyBuckets.at(-1).tokens, 99,
        'duplicate cached days keep the latest valid value');

    const provider = new CodexProvider(
        new FakeSettings({'codex-refresh-minutes': 15}),
        inertScheduler,
        null
    );
    let calls = 0;
    let release = null;
    provider._refresh = () => {
        calls++;
        return new Promise(resolve => { release = resolve; });
    };
    const first = provider.refresh(true);
    const second = provider.refresh(true);
    equal(calls, 1, 'rapid Codex refreshes coalesce into one app-server request');
    release(provider.getState());
    await Promise.all([first, second]);
    provider.destroy();
}

async function testAdaptiveCodexRefreshLifecycle() {
    const scheduler = new RecordingScheduler();
    const provider = new CodexProvider(new FakeSettings(), scheduler, null);
    provider._cache.read = async () => null;
    provider._historyStore.read = async () => null;
    provider._cache.write = async () => {};
    provider._historyStore.write = async () => {};
    let refreshes = 0;
    provider._refresh = async () => {
        refreshes++;
        return provider.getState();
    };

    await provider.start();
    equal(refreshes, 1, 'extension startup immediately refreshes Codex');
    equal(scheduler.jobs.get('codex-refresh').seconds, BACKGROUND_CODEX_REFRESH_INTERVAL,
        'closed popup uses the 60-second Codex cadence');
    equal(scheduler.jobs.size, 1, 'Codex owns one adaptive refresh timer');

    await provider.setViewVisible(true, true);
    equal(refreshes, 2, 'opening the visible Codex page refreshes immediately');
    equal(scheduler.jobs.get('codex-refresh').seconds, VISIBLE_CODEX_REFRESH_INTERVAL,
        'visible Codex page uses the 30-second cadence');
    await scheduler.run('codex-refresh');
    equal(refreshes, 3, 'visible cadence performs an automatic refresh');

    await provider.setViewVisible(false, false);
    equal(scheduler.jobs.get('codex-refresh').seconds, BACKGROUND_CODEX_REFRESH_INTERVAL,
        'popup close returns to the background cadence');
    await provider.setViewVisible(true, true);
    equal(refreshes, 4, 'activating the Codex tab refreshes immediately');
    await provider.setViewVisible(false, false);
    await provider.setViewVisible(true, false);
    await provider.setViewVisible(false, false);
    equal(scheduler.jobs.size, 1, 'repeated popup transitions never multiply timers');

    const schedulesBeforeManual = scheduler.schedules;
    await provider.refresh(true);
    equal(refreshes, 5, 'manual refresh uses the shared provider path');
    equal(scheduler.schedules, schedulesBeforeManual,
        'manual refresh does not create or reschedule a timer');

    provider.destroy();
    equal(scheduler.jobs.size, 0, 'provider teardown removes the adaptive refresh timer');

    const startupScheduler = new RecordingScheduler();
    const startupProvider = new CodexProvider(new FakeSettings(), startupScheduler, null);
    let finishCacheRead = null;
    startupProvider._cache.read = () => new Promise(resolve => { finishCacheRead = resolve; });
    startupProvider._historyStore.read = async () => null;
    let startupRefreshes = 0;
    startupProvider._refresh = async () => {
        startupRefreshes++;
        return startupProvider.getState();
    };
    const startup = startupProvider.start();
    const earlyPopup = startupProvider.setViewVisible(true, true);
    finishCacheRead(null);
    await Promise.all([startup, earlyPopup]);
    equal(startupRefreshes, 1,
        'popup activation during initialization coalesces with the startup refresh');
    equal(startupScheduler.jobs.get('codex-refresh').seconds,
        VISIBLE_CODEX_REFRESH_INTERVAL,
        'early popup activation starts directly on the visible cadence');
    startupProvider.destroy();
}

async function testFrequentCodexRefreshIntegrity() {
    const scheduler = new RecordingScheduler();
    const provider = new CodexProvider(new FakeSettings(), scheduler, null);
    provider._cache.read = async () => null;
    provider._historyStore.read = async () => null;
    let cacheWrites = 0;
    let historyWrites = 0;
    provider._cache.write = async () => { cacheWrites++; };
    provider._historyStore.write = async () => { historyWrites++; };
    let usedPercent = 94;
    let fail = false;
    const today = localUsageDateKey(Date.now());
    provider._readAppServer = async () => {
        if (fail)
            throw new Error('temporary failure');
        return {
            rateLimitsResponse: {
                rateLimits: {
                    primary: {
                        usedPercent,
                        windowDurationMins: 10080,
                        resetsAt: 2_000_000_000,
                    },
                },
                rateLimitResetCredits: {availableCount: 1, credits: []},
            },
            usageResponse: {
                summary: {lifetimeTokens: 5_000},
                dailyUsageBuckets: [{startDate: today, tokens: 200}],
            },
        };
    };
    const observedRemaining = [];
    provider.subscribe(state => {
        const remaining = codexRemainingSummary(state);
        if (remaining !== null)
            observedRemaining.push(remaining);
    });

    let state = await provider.start();
    equal(state.weekly.remainingPercent, 6, 'initial live Codex value is truthful');
    equal(cacheWrites, 1, 'first live limit sample is cached once');
    equal(historyWrites, 1, 'first current-day token sample is stored once');

    usedPercent = 95;
    state = await scheduler.run('codex-refresh');
    equal(state.weekly.remainingPercent, 5, 'automatic refresh publishes a changed percentage');
    equal(observedRemaining.at(-1), 5,
        'provider subscribers receive automatic changes for the top bar');
    equal(state.tokenUsage.dailyBuckets.length, 1,
        'frequent refresh keeps one real history bucket for the current day');
    equal(historyWrites, 1, 'unchanged same-day activity is not written again');

    const writesAfterChange = cacheWrites;
    state = await scheduler.run('codex-refresh');
    equal(cacheWrites, writesAfterChange,
        'unchanged limits do not cause another cache write');

    fail = true;
    const previousReset = state.weekly.resetsAt;
    state = await scheduler.run('codex-refresh');
    equal(state.status, 'stale', 'transient failure marks the live sample stale');
    equal(state.weekly.remainingPercent, 5,
        'transient failure preserves the last-known-good percentage');
    equal(state.weekly.resetsAt, previousReset,
        'transient failure preserves the last-known-good reset time');
    equal(state.resetCreditsAvailable, 1,
        'transient failure preserves reset credits');
    equal(state.tokenUsage.dailyBuckets.length, 1,
        'transient failure does not inflate token history');

    const weatherScheduler = new RecordingScheduler();
    const weather = new WeatherProvider(new FakeSettings({
        'weather-refresh-minutes': 30,
        'weather-location': 'Cairo, Egypt',
        'weather-unit': 'celsius',
    }), weatherScheduler, null);
    weather._reschedule();
    equal(weatherScheduler.jobs.get('weather-refresh').seconds, 30 * 60,
        'adaptive Codex work leaves Weather cadence unchanged');
    weather.destroy();
    provider.destroy();
}

async function testCodexProtocolOrdering() {
    const fakeServer = GLib.build_filenamev([
        GLib.get_tmp_dir(),
        `shadow-panel-fake-codex-${GLib.uuid_string_random()}`,
    ]);
    const source = `#!/bin/sh
set -eu
IFS= read -r initialize
case "$initialize" in
  *'"requestAttestation":false'*) ;;
  *) exit 2 ;;
esac
printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"userAgent":"codex-cli/9.9.9"}}'
IFS= read -r initialized
    IFS= read -r usage
    IFS= read -r limits
    case "$initialized:$usage:$limits" in
      *'"method":"initialized"'*':'*'"id":2'*':'*'"id":3'*) ;;
      *) exit 3 ;;
    esac
    printf '%s\n' '{"jsonrpc":"2.0","id":3,"result":{"rateLimits":{"primary":{"usedPercent":10,"windowDurationMins":10080,"resetsAt":2000000000}}}}'
    printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"summary":{"lifetimeTokens":1234,"peakDailyTokens":900},"dailyUsageBuckets":[{"startDate":"2026-08-29","tokens":334}]}}'
sleep 5
`;
    GLib.file_set_contents(fakeServer, source);
    GLib.chmod(fakeServer, 0o700);
    const provider = new CodexProvider(
        new FakeSettings({'codex-refresh-minutes': 15}),
        inertScheduler,
        null
    );
    provider._findCodex = () => fakeServer;
    provider._cache.write = async () => {};
    try {
        const state = await provider.refresh(true);
        equal(state.status, 'success', 'Codex protocol follows the initialized request order');
        equal(state.weekly.remainingPercent, 90,
            'Codex accepts valid limits without waiting for optional account metadata');
        equal(state.tokenUsage.lifetimeTokens, 1234,
            'Codex waits for out-of-order account token activity');
    } finally {
        provider.destroy();
        GLib.unlink(fakeServer);
    }
}

async function testWeatherTrailingRefresh() {
    const settings = new FakeSettings({
        'weather-refresh-minutes': 30,
        'weather-location': 'Cairo, Egypt',
        'weather-unit': 'celsius',
    });
    const provider = new WeatherProvider(settings, inertScheduler, null);
    let releaseFirst;
    let calls = 0;
    provider._refresh = () => {
        calls++;
        if (calls === 1)
            return new Promise(resolve => { releaseFirst = resolve; });
        return Promise.resolve(provider.getState());
    };
    const first = provider.refresh(true);
    provider._queueSettingsRefresh(true);
    await waitMilliseconds(500);
    equal(calls, 1, 'Weather settings debounce does not start an overlapping request');
    releaseFirst(provider.getState());
    await first;
    await waitMilliseconds(20);
    equal(calls, 2, 'Weather settings changes queue exactly one trailing refresh');
    provider.destroy();
}

testFormatting();
testModuleConfiguration();
testSparklineData();
testProgressGeometry();
testSchedulerLifecycle();
testCodexNormalization();
testCodexPortability();
testCodexLocalHistory();
testTopBarSummaries();
testWeatherNormalization();
testExtendedWeatherForecast();
testContentValidation();
await testWeatherLocationFallback();
await testCodexShareImage();
await testProviderFailureIsolation();
await testPersistenceAndRefreshCoalescing();
await testAdaptiveCodexRefreshLifecycle();
await testFrequentCodexRefreshIntegrity();
await testCodexProtocolOrdering();
await testWeatherTrailingRefresh();

print(`Shadowokx Panel tests passed (${assertions} assertions)`);

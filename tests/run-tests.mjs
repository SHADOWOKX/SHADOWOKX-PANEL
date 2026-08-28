import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {clampPercent, formatCountdown, formatResetDate, isHexColor} from '../lib/format.js';
import {chooseInitialModule} from '../lib/moduleConfig.js';
import {codexRemainingSummary, weatherSummaryTemperature} from '../lib/summary.js';
import {
    normalizeCachedRateLimits,
    normalizeRateLimits,
    planLabel,
} from '../modules/codex/normalize.js';
import {CodexProvider} from '../modules/codex/provider.js';
import {exportCodexSummaryImage, resolveSharePalette} from '../modules/codex/shareImage.js';
import {
    normalizeWeather,
    normalizeWeatherQuery,
    weatherCacheMatchesSettings,
    weatherCondition,
} from '../modules/weather/normalize.js';
import {WeatherProvider} from '../modules/weather/provider.js';
import {Observable} from '../services/observable.js';
import {Logger} from '../services/logger.js';

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

function testFormatting() {
    equal(clampPercent(112), 100, 'percent upper clamp');
    equal(clampPercent(-4), 0, 'percent lower clamp');
    equal(formatCountdown(4600, 1_000_000), 'Resets in 1h 0m', 'countdown formatting');
    equal(formatResetDate(Number.MAX_VALUE), 'Reset time unavailable', 'invalid reset dates are rejected');
    ok(isHexColor('#8b5cf6'), 'valid custom accent');
    ok(!isHexColor('purple'), 'invalid custom accent');
}

function testModuleConfiguration() {
    const pages = ['codex', 'weather'];
    equal(chooseInitialModule(pages, true, 'weather', 'codex'), 'weather', 'last page wins');
    equal(chooseInitialModule(pages, false, 'weather', 'codex'), 'codex', 'default page wins');
    equal(chooseInitialModule(pages, true, 'notes', 'codex'), 'codex',
        'removed pages safely fall back to Codex');
}

function testCodexNormalization() {
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
    }, 1234, {
        accountResponse: {account: {email: 'shadow@example.test', planType: 'plus', type: 'chatgpt'}},
        initializeResponse: {userAgent: 'codex-cli/0.150.0-alpha.12.2'},
    });
    equal(state.fiveHour.usedPercent, 68, 'five-hour usage');
    equal(state.fiveHour.remainingPercent, 32, 'five-hour remaining');
    equal(state.weekly.usedPercent, 43, 'weekly usage');
    equal(state.accountName, 'shadow', 'only the non-secret account display name is retained');
    equal(state.planLabel, 'Codex Plus', 'plan gets a friendly label');
    equal(state.clientVersion, '0.150.0-alpha.12.2', 'client version is normalized');
    equal(state.resetCreditsAvailable, 1, 'reset-credit count is normalized');
    equal(state.lastSuccessfulRefresh, 1234, 'Codex refresh timestamp');
    equal(planLabel('__proto__'), 'Codex account', 'prototype names cannot become plan labels');

    const weeklyOnly = normalizeRateLimits({
        rateLimitsByLimitId: {
            codex: {primary: {usedPercent: 4, windowDurationMins: 10080, resetsAt: 2_000_000_000}},
        },
        rateLimits: {},
    });
    equal(weeklyOnly.fiveHour, null, 'missing five-hour remains unavailable');
    equal(weeklyOnly.weekly.usedPercent, 4, 'weekly-only response');
    equal(normalizeCachedRateLimits({lastSuccessfulRefresh: Date.now()}), null,
        'semantically empty Codex caches are rejected');
    equal(normalizeCachedRateLimits({
        lastSuccessfulRefresh: Date.now() + 10 * 60 * 1000,
        weekly: {usedPercent: 1, resetsAt: 2_000_000_000},
    }), null, 'future Codex caches are rejected');
}

function testTopBarSummaries() {
    equal(codexRemainingSummary({fiveHour: {remainingPercent: 89.4}, weekly: {remainingPercent: 60}}),
        60, 'Codex summary prefers the weekly remaining capacity');
    equal(codexRemainingSummary({fiveHour: {remainingPercent: 57}, weekly: null}),
        57, 'Codex summary falls back to five-hour remaining capacity');
    equal(weatherSummaryTemperature({current: {temperature: 33.6}}),
        34, 'weather summary rounds temperature');
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
        daily: {temperature_2m_max: [33], temperature_2m_min: [22]},
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
    equal(state.forecast[1].precipitationChance, 27, 'hourly rain chance is normalized');
    equal(weatherCondition(999).label, 'Unknown conditions', 'unknown weather code');
    equal(weatherCondition('__proto__').label, 'Unknown conditions',
        'prototype names cannot become weather conditions');
    for (const code of [56, 57, 66, 67, 77, 85, 86])
        ok(weatherCondition(code).label !== 'Unknown conditions', `WMO code ${code} is mapped`);
    equal(normalizeWeatherQuery('  Cairo\n\u202e Egypt  '), 'Cairo Egypt',
        'weather queries remove controls and normalize whitespace');
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
        daily: {temperature_2m_max: [33], temperature_2m_min: [22]},
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
    weather.destroy();
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
IFS= read -r account
IFS= read -r limits
case "$initialized:$account:$limits" in
  *'"method":"initialized"'*':'*'"id":2'*':'*'"id":3'*) ;;
  *) exit 3 ;;
esac
printf '%s\n' '{"jsonrpc":"2.0","id":3,"result":{"rateLimits":{"primary":{"usedPercent":10,"windowDurationMins":10080,"resetsAt":2000000000}}}}'
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
        equal(state.clientVersion, '9.9.9', 'Codex initialize metadata is retained');
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
testCodexNormalization();
testTopBarSummaries();
testWeatherNormalization();
testContentValidation();
await testCodexShareImage();
await testProviderFailureIsolation();
await testCodexProtocolOrdering();
await testWeatherTrailingRefresh();

print(`Shadow Panel tests passed (${assertions} assertions)`);

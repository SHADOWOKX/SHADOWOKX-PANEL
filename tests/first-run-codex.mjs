import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import {CodexProvider} from '../modules/codex/provider.js';

if (GLib.getenv('SHADOW_PANEL_TEST_ISOLATED') !== '1')
    throw new Error('Refusing to run first-run tests without an isolated user environment');

const scenario = ARGV[0];
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

const settings = {
    get_int() { return 15; },
    connect() { return 1; },
    disconnect() {},
};
const scheduler = {every() {}, cancel() {}};
const logger = {debug() {}, warn() {}};
const dataDirectory = GLib.build_filenamev([GLib.get_user_data_dir(), 'shadow-panel']);
const cacheDirectory = GLib.build_filenamev([GLib.get_user_cache_dir(), 'shadow-panel']);
const executable = GLib.build_filenamev([GLib.get_user_data_dir(), 'pnpm', 'codex']);

function dateKey(offsetDays = 0) {
    const date = new Date(Date.now() + offsetDays * 86_400_000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function installFakeCodex(authenticated) {
    GLib.mkdir_with_parents(GLib.path_get_dirname(executable), 0o700);
    const yesterday = dateKey(-1);
    const today = dateKey();
    const limits = authenticated
        ? `{"jsonrpc":"2.0","id":3,"result":{"rateLimits":{"primary":{"usedPercent":11,"windowDurationMins":10080,"resetsAt":2000000000}}}}`
        : '{"jsonrpc":"2.0","id":3,"error":{"code":-32000,"message":"account unavailable"}}';
    const usage = authenticated
        ? `{"jsonrpc":"2.0","id":2,"result":{"summary":{"lifetimeTokens":5000},"dailyUsageBuckets":[{"startDate":"${yesterday}","tokens":999},{"startDate":"${today}","tokens":200}]}}`
        : '{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"account unavailable"}}';
    const source = `#!/bin/sh
set -eu
IFS= read -r initialize
printf '%s\\n' '{"jsonrpc":"2.0","id":1,"result":{}}'
IFS= read -r initialized
IFS= read -r usage_request
IFS= read -r limits_request
printf '%s\\n' '${usage}'
printf '%s\\n' '${limits}'
`;
    GLib.file_set_contents(executable, source);
    GLib.chmod(executable, 0o700);
}

if (!['authenticated', 'unauthenticated', 'missing', 'existing-history'].includes(scenario)) {
    printerr('Unknown first-run scenario');
    System.exit(2);
}

if (scenario !== 'missing')
    installFakeCodex(scenario !== 'unauthenticated');

if (scenario === 'existing-history') {
    GLib.mkdir_with_parents(dataDirectory, 0o700);
    GLib.file_set_contents(
        GLib.build_filenamev([dataDirectory, 'codex-history.json']),
        `${JSON.stringify({
            version: 1,
            startedAt: Date.now() - 86_400_000,
            dailyBuckets: [{date: dateKey(-1), tokens: 100}],
        })}\n`
    );
}

const provider = new CodexProvider(settings, scheduler, logger);
if (scenario === 'missing')
    provider._findCodex = () => null;

try {
    if (scenario !== 'missing')
        equal(provider._findCodex(), executable,
            'the current user installation is discovered without a configured path');
    const state = await provider.start();
    if (scenario === 'authenticated') {
        equal(state.status, 'success', 'authenticated first run loads current limits');
        equal(state.weekly.remainingPercent, 89, 'authenticated first run shows current capacity');
        equal(state.tokenUsage.dailyBuckets.length, 1,
            'authenticated first run does not import older account-side history');
        equal(state.tokenUsage.dailyBuckets[0].date, dateKey(),
            'authenticated first run records only its first current-day sample');
        ok(GLib.file_test(
            GLib.build_filenamev([dataDirectory, 'codex-history.json']),
            GLib.FileTest.IS_REGULAR
        ), 'local history is created under the isolated user data directory');
        ok(GLib.file_test(
            GLib.build_filenamev([cacheDirectory, 'codex.json']),
            GLib.FileTest.IS_REGULAR
        ), 'current limits are cached under the isolated user cache directory');
    } else if (scenario === 'unauthenticated') {
        equal(state.status, 'error', 'an unusable account produces an error state');
        equal(state.errorCode, 'usage-unavailable',
            'an unusable account gets a sign-in recovery state');
        ok(state.error.includes('sign'), 'the recovery message directs the user to Codex sign-in');
    } else if (scenario === 'missing') {
        equal(state.status, 'error', 'missing Codex produces an error state');
        equal(state.errorCode, 'not-installed', 'missing Codex is distinguished from account failure');
    } else {
        equal(state.status, 'success', 'existing history loads with current limits');
        equal(state.tokenUsage.dailyBuckets.length, 2,
            'existing history gains exactly one current-day entry');
        equal(state.tokenUsage.dailyBuckets[0].tokens, 100,
            'older local history is not replaced by account-side history');
        const refreshed = await provider.refresh(true);
        equal(refreshed.tokenUsage.dailyBuckets.length, 2,
            'repeated refresh does not duplicate same-day history');
        const [loaded, cacheBytes] = GLib.file_get_contents(
            GLib.build_filenamev([cacheDirectory, 'codex.json'])
        );
        ok(loaded, 'the current-limit cache is readable');
        const cached = JSON.parse(new TextDecoder().decode(cacheBytes));
        equal(cached.tokenUsage.dailyBuckets.length, 0,
            'current-limit cache remains separate from local graph history');
    }
} finally {
    provider.destroy();
}

print(`Fresh-user Codex ${scenario} scenario passed (${assertions} assertions)`);

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {CommandCodeApi, COMMANDCODE_API_INTERVAL} from '../modules/ai/commandcodeApi.js';
import {CommandCodeError, parseCommandCodeUsage, retryAfterTime, decodeCommandCodeResponse} from '../lib/commandcodeUsage.js';
import {AIProvider} from '../modules/ai/provider.js';
import {GOAT_REFERENCE} from '../lib/commandcodeReference.js';
import {reportedAllowanceSummary} from '../lib/summary.js';

if (GLib.getenv('SHADOW_PANEL_TEST_ISOLATED') !== '1') throw new Error('Isolated tests required');
let assertions = 0;
function check(value, message) { assertions++; if (!value) throw new Error(message); }
async function failure(action, code) {
    try { await action(); } catch (error) {
        check(error instanceof CommandCodeError && error.code === code, 'Fixed safe failure code');
        check(!error.message.includes(KEY), 'Credential never reaches diagnostics');
        return;
    }
    throw new Error('Expected failure');
}
const KEY = 'offline-test-key';
const root = Gio.File.new_for_uri(import.meta.url).get_parent().get_path();
const [, bytes] = Gio.File.new_for_path(`${root}/fixtures/commandcode-authenticated.json`).load_contents(null);
const fixture = JSON.parse(new TextDecoder().decode(bytes));
let now = fixture.capturedAt;
const parse = value => parseCommandCodeUsage(value.whoami, value.credits, value.subscription, value.summary, now);
const data = parse(fixture);
check(data.plan === 'GOAT' && data.planStatus === 'active', 'Verified plan identity');
check(data.windows[0].cap === 14 && data.windows[1].cap === 35, 'Only returned account caps');
check(data.windows[1].used === fixture.credits.windowLimits.weekly.used, 'Reported usage retained');
check(data.windows[1].resetsAt === 1791549905361, 'Actual reset epoch retained');
check(data.consumption.monthlyUsedCredits === fixture.summary.totalMonthlyCredits && data.consumption.requests === 304,
    'Actual monthly consumed credits and request count');
check(!('monthlyCap' in data) && !('monthlyPercent' in data), 'No cap estimated from plan/reference');
check(!('usedPercent' in GOAT_REFERENCE), 'Published GOAT card cannot become consumption');
check(data.creditBalances[0].amount === fixture.credits.credits.monthlyCredits, 'Monthly remaining reported separately');
check(data.creditBalances[1].amount === 0, 'Reported zero balance retained');
check(reportedAllowanceSummary(data, now).window.resetsAt === 1791549905.361, 'Top-bar reset uses seconds without changing provider data');
check(reportedAllowanceSummary(data, now).percent === 96, 'Top-bar remaining percent comes from reported window cap');
check(reportedAllowanceSummary({windows: [{usedPercent: null}]}).percent === null, 'Missing percentage never becomes 100% remaining');
check(reportedAllowanceSummary(null).percent === null, 'Stale native summary can be hidden');
check(reportedAllowanceSummary(data, 1791549905362).percent === null, 'Expired top-bar snapshot is unavailable');
const missing = parse({...fixture, summary: {}, subscription: null,
    credits: {credits: {monthlyCredits: 0}, windowLimits: {fiveHour: {cap: 14}}}});
check(missing.windows.length === 0 && missing.consumption.requests === null && missing.consumption.usedCredits === null,
    'Missing data never becomes zero consumption or requests');
const expired = parseCommandCodeUsage(fixture.whoami, fixture.credits, null, null, 1791549905362);
check(expired.windows.length === 0, 'Expired snapshots cannot describe new allowance');
const variants = JSON.parse(JSON.stringify(fixture));
variants.credits = {data: variants.credits};
variants.subscription.data.currentPeriodEnd = new Date(1793622018000).toISOString();
variants.credits.data.windowLimits.five_hour = {...variants.credits.data.windowLimits.fiveHour, reset_at: 1791039150};
delete variants.credits.data.windowLimits.five_hour.resetAt;
delete variants.credits.data.windowLimits.fiveHour;
check(parse(variants).windows[0].resetsAt === 1791039150000, 'Verified wrapper/snake-case timestamps supported');
check(parse(variants).consumption.periodEnd === 1793622018000, 'ISO billing period timestamp supported');
const zero = JSON.parse(JSON.stringify(fixture));
zero.credits.windowLimits.fiveHour = {used: 0, cap: 0, exceeded: true};
check(parse(zero).windows[0].usedPercent === null && parse(zero).windows[0].exceeded === true,
    'No percentage invented for zero cap');
check(retryAfterTime('600', now) === now + 600000, 'Server Retry-After seconds respected');
check(retryAfterTime(new Date(now + 600000).toUTCString(), now) === Math.floor((now + 600000) / 1000) * 1000,
    'Server Retry-After HTTP date respected');
await failure(() => Promise.resolve(decodeCommandCodeResponse(new TextEncoder().encode('<html>private-key</html>'))), 'api-changed');
await failure(() => Promise.resolve(decodeCommandCodeResponse(new Uint8Array(1024 * 1024 + 1))), 'api-changed');
await failure(() => Promise.resolve(parseCommandCodeUsage({success: false}, {})), 'api-changed');

const paths = [];
const route = path => path.startsWith('/alpha/whoami') ? fixture.whoami
    : path.startsWith('/alpha/billing/credits') ? fixture.credits
        : path.startsWith('/alpha/billing/subscriptions') ? fixture.subscription : fixture.summary;
const api = new CommandCodeApi({clock: () => now, request: async (path, key, _cancel, request) => {
    paths.push(path);
    check(key === KEY && request.method === 'GET', 'Reads use a supplied credential and GET only');
    check(request.headers.Authorization === `Bearer ${KEY}` && request.headers.Accept === 'application/json'
        && request.headers['User-Agent'] === 'commandcode-usage/1.0', 'Verified authentication headers');
    return {status: 200, body: JSON.stringify(route(path))};
}});
const first = api.fetch(KEY), second = api.fetch(KEY);
check(first === second, 'Concurrent requests coalesce');
await first;
check(paths.length === 4, 'Exactly four supported GET endpoints on first capture');
await api.fetch(KEY);
check(paths.length === 7 && paths.filter(p => p === '/alpha/whoami').length === 1, 'Identity cached for 15 minutes');
now += 900001;
await api.fetch(KEY);
check(paths.filter(p => p === '/alpha/whoami').length === 2, 'Identity periodically revalidated');
await failure(() => api._get('/v1/messages', KEY, null), 'api-changed');
api.destroy();
await failure(() => api.fetch(KEY), 'cancelled');
const cancellation = new Gio.Cancellable(); cancellation.cancel();
let cancelledCalls = 0;
const cancelledApi = new CommandCodeApi({request: async () => { cancelledCalls++; return {status: 200}; }});
await failure(() => cancelledApi.fetch(KEY, cancellation), 'cancelled');
check(cancelledCalls === 0, 'Cancelled refresh cannot issue network requests');
cancelledApi.destroy();

let calls = 0;
const auth = new CommandCodeApi({request: async () => { calls++; return {status: 401, data: {error: KEY}}; }});
await failure(() => auth.fetch(KEY), 'authentication-failed');
check(calls === 1, 'Invalid authentication stops before other requests');
auth.destroy();
let limitedCalls = 0;
const limited = new CommandCodeApi({clock: () => now, request: async () => { limitedCalls++; return {status: 429, retryAfter: '600'}; }});
await failure(() => limited.fetch(KEY), 'rate-limited');
await failure(() => limited.fetch(KEY), 'rate-limited');
check(limitedCalls === 1, 'Manual refresh cannot bypass Retry-After');
now += 600001;
await failure(() => limited.fetch(KEY), 'rate-limited');
check(limitedCalls === 2, 'Requests resume when server retry deadline expires');
limited.destroy();

let optionalCalls = 0;
const partial = new CommandCodeApi({clock: () => fixture.capturedAt, request: async path => {
    if (path.includes('subscriptions') || path.includes('summary')) { optionalCalls++; return {status: 404}; }
    return {status: 200, data: route(path)};
}});
const partialData = await partial.fetch(KEY);
check(partialData.windows.length === 2 && partialData.consumption.requests === null && partialData.warnings.length === 1,
    'Optional endpoint failure retains real window data and marks missing fields');
await partial.fetch(KEY);
check(optionalCalls === 2, 'Unsupported optional endpoints are not repeatedly probed');
partial.destroy();
const reflected = new CommandCodeApi({request: async path => ({status: 200, data: path === '/alpha/whoami'
    ? {user: {userName: KEY}} : route(path)})});
check((await reflected.fetch(KEY)).account === null, 'Upstream credential reflection cannot reach UI');
reflected.destroy();
const failed = new CommandCodeApi({request: async () => { throw new Error(KEY); }});
await failure(() => failed.fetch(KEY), 'network');
failed.destroy();
const timeoutApi = new CommandCodeApi({timeoutMs: 10, request: (_path, _key, cancelled) =>
    new Promise((_resolve, reject) => cancelled.connect(() => reject(new Error(KEY))))});
await failure(() => timeoutApi.fetch(KEY), 'timeout');
timeoutApi.destroy();

const settings = {get_string() { return '{"commandcode":{"mode":"api"}}'; }, connect() { return 1; }, disconnect() {}};
let interval, attempts = 0, destroyed = false, rejected = false;
const backend = {async fetch() { attempts++; if (rejected) throw new CommandCodeError('network'); return {...parse(fixture), updatedAt: Date.now()}; }, destroy() { destroyed = true; }};
const scheduler = {every(_name, seconds) { interval = seconds; }, cancel() {}};
const provider = new AIProvider('commandcode', settings, scheduler, {commandCodeApi: backend, lookupKey: async () => KEY});
await provider.start();
check(interval === COMMANDCODE_API_INTERVAL && interval === 180, 'Three-minute asynchronous refresh scheduled');
check(provider.getState().data.source === 'commandcode-api' && provider.getState().lastSuccessfulRefresh,
    'Native provider displays actual normalized API data and success time');
await provider.refresh(false);
check(attempts === 1, 'Popup opens do not issue unnecessary account requests');
await provider.refresh();
check(attempts === 2, 'Explicit manual refresh runs');
rejected = true;
await provider.refresh();
check(provider.getState().status === 'stale' && provider.getState().data !== null, 'Network failure marks last-known data stale');
backend.fetch = async () => { throw new CommandCodeError('authentication-failed'); };
await provider.refresh();
check(provider.getState().status === 'unavailable' && provider.getState().data === null, 'Revoked credentials clear live account data');
provider.destroy();
await provider.refresh();
check(destroyed && attempts === 3, 'Destroy cancels native transport and prevents further reads');
const locked = new AIProvider('commandcode', settings, scheduler, {commandCodeApi: backend,
    lookupKey: async () => { throw new CommandCodeError('keyring-locked'); }});
await locked.start();
check(locked.getState().errorCode === 'keyring-locked' && !locked.getState().data, 'Locked keyring has clear state without plaintext fallback');
locked.destroy();
print(`Command Code native API tests passed (${assertions} assertions).`);

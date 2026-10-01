import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {normalizeUsage, usageTaskActive} from '../modules/ai/normalize.js';
import {visibleModules, chooseInitialModule} from '../lib/moduleConfig.js';
import {AIProvider} from '../modules/ai/provider.js';
import {AIActivityMonitor, providerForApplication, providerForProcess, providerForEntrypoint} from '../services/aiActivity.js';
import {connectClaude, connectUsageFile, saveDeepseekKey} from '../modules/ai/connections.js';
import {Scheduler} from '../services/scheduler.js';

if (GLib.getenv('SHADOW_PANEL_TEST_ISOLATED') !== '1') throw new Error('Isolated AI tests required');

let assertions = 0;
function check(value, message) {
    assertions++;
    if (!value) throw new Error(message);
}
function fails(callback, message) {
    try { callback(); } catch { check(true, message); return; }
    throw new Error(message);
}
const now = Date.now();
check(!usageTaskActive(normalizeUsage({windows: [{usedPercent: 35}]}, 'claude')),
    'Quota refresh is not work activity');
const working = normalizeUsage({windows: [{usedPercent: 35}],
    activity: {active: true, updatedAt: now, expiresAt: now + 1000}}, 'claude', now);
check(usageTaskActive(working, now), 'Explicit current task report triggers work');
check(!usageTaskActive(working, now + 1001), 'Expired task reports stop work');
check(!usageTaskActive(normalizeUsage({windows: [{usedPercent: 35}], activity: {active: true}}, 'claude')),
    'Untimestamped activity cannot keep animation running');
const claude = normalizeUsage({rate_limits: {five_hour: {used_percentage: 0, resets_at: (now + 3600000) / 1000},
    seven_day: {used_percentage: 65}}, context_window: {used_percentage: 99}}, 'claude', now);
check(claude.windows.length === 2 && claude.windows[0].usedPercent === 0,
    'Real Claude rate limits retain a zero-percent allowance');
check(claude.windows[0].resetsAt === now + 3600000, 'Claude reset seconds become milliseconds');
fails(() => normalizeUsage({context_window: {used_percentage: 25}}, 'claude'),
    'Context utilization is never reported as subscription utilization');
fails(() => normalizeUsage({windows: [{usedPercent: 20, resetsAt: now - 1000}]}, 'gemini', now),
    'Expired windows are unavailable rather than invented fresh capacity');
fails(() => normalizeUsage({windows: [{usedPercent: '20'}]}, 'glm'), 'Invalid percentages are rejected');
const deepseek = normalizeUsage({balance_infos: [{currency: 'USD', total_balance: '0.00'}]}, 'deepseek');
check(deepseek.balances[0].amount === 0, 'Zero API balance is valid');
check(deepseek.windows.length === 0, 'API balance does not imply a subscription percentage');
check(normalizeUsage({windows: [{usedPercent: 150}]}, 'commandcode').windows[0].usedPercent === 100,
    'Out-of-range percentages are bounded for rendering');
check(normalizeUsage({tokens: {total: 0}}, 'opencode').tokens === 0, 'Zero reported tokens remain visible');

class Settings {
    constructor() {
        this.sources = '{}';
        this.added = ['claude', 'codex', 'claude', 'invalid'];
        this.hidden = ['codex'];
        this.listeners = new Map();
        this.next = 1;
    }
    get_string() { return this.sources; }
    set_string(_key, value) { this.change(JSON.parse(value)); }
    get_strv(key) { return key === 'ai-providers' ? this.added : this.hidden; }
    get_boolean() { return true; }
    set_strv(key, value) { if (key === 'ai-providers') this.added = value; else this.hidden = value; }
    connect(_key, fn) { const id = this.next++; this.listeners.set(id, fn); return id; }
    disconnect(id) { this.listeners.delete(id); }
    change(value) { this.sources = JSON.stringify(value); for (const fn of this.listeners.values()) fn(); }
}
const settings = new Settings();
check(visibleModules(settings).join(',') === 'claude,weather', 'Hidden, duplicate and unknown IDs are filtered');
check(chooseInitialModule(visibleModules(settings), true, 'codex', 'codex') === 'claude',
    'Removing the active/default provider selects a visible page');

const directory = GLib.dir_make_tmp('shadow-ai-tests-XXXXXX');
const path = GLib.build_filenamev([directory, 'usage.json']);
const write = value => GLib.file_set_contents(path, JSON.stringify(value));
write({plan: 'Test plan', windows: [{label: 'Weekly', usedPercent: 35}], updatedAt: now});
settings.change({claude: {path}});
const scheduler = new Scheduler(null);
const provider = new AIProvider('claude', settings, scheduler);
await provider.start();
check(provider.getState().data.windows[0].usedPercent === 35, 'Provider reads actual local source');
check(scheduler._sources.has('ai-claude'), 'Provider refresh is scheduled');
write({windows: [{usedPercent: 48}], updatedAt: now});
await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 450, () => { resolve(); return GLib.SOURCE_REMOVE; }));
check(provider.getState().data.windows[0].usedPercent === 48, 'File changes refresh usage without a manual request');
write({balance: {amount: 5, currency: 'USD'}, updatedAt: now - 600000});
await provider.refresh();
check(provider.getState().status === 'stale', 'Old export is visibly stale');
GLib.file_set_contents(path, '{broken JSON');
await provider.refresh();
check(provider.getState().status === 'stale' && provider.getState().data.balances[0].amount === 5,
    'Malformed refresh retains clearly stale last valid data');
provider._setState({status: 'ready', data: {windows: [{usedPercent: 80, resetsAt: Date.now() - 1}],
    balances: [], tokens: null, updatedAt: now}});
await provider.refresh();
check(provider.getState().data === null, 'Expired allowance is not retained during source failure');
settings.change({claude: {path: `${directory}/missing.json`}});
await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => { resolve(); return GLib.SOURCE_REMOVE; }));
await provider.refresh();
check(provider.getState().data === null && provider.getState().status === 'unavailable',
    'Changing source never retains the previous account data');
provider.destroy();
check(settings.listeners.size === 0 && !scheduler._sources.has('ai-claude'),
    'Removing provider disconnects settings and cancels refresh');
scheduler.destroy();
write({windows: [{usedPercent: 25}]});
await connectUsageFile(settings, 'gemini', path);
check(JSON.parse(settings.sources).gemini.path === path, 'Connection picker validates and saves the selected source');
check(settings.added.includes('gemini') && !settings.hidden.includes('gemini'), 'Connecting a provider automatically makes its button visible');
await saveDeepseekKey(settings, 'test-private-token', `${directory}/keys`);
check(!settings.sources.includes('test-private-token'), 'Credentials are not saved in settings');
const keyFile = Gio.File.new_for_path(`${directory}/keys/deepseek.key`);
check((keyFile.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null).get_attribute_uint32('unix::mode') & 0o777) === 0o600,
    'Pasted key is stored in a private file');
const claudeDir = `${directory}/claude`;
GLib.mkdir_with_parents(claudeDir, 0o700);
GLib.file_set_contents(`${claudeDir}/settings.json`, JSON.stringify({theme: 'dark',
    statusLine: {type: 'command', command: "printf '%s' 'MY STATUS'"}, permissions: {allow: ['Read']}}));
await connectClaude(settings, '/tmp/test-extension', claudeDir);
const readJson = value => JSON.parse(new TextDecoder().decode(GLib.file_get_contents(value)[1]));
const connected = readJson(`${claudeDir}/settings.json`);
check(connected.theme === 'dark' && connected.permissions.allow[0] === 'Read', 'Claude connection preserves unrelated settings');
check(connected.statusLine.command.includes('--previous-command'), 'Claude custom status line is chained rather than replaced');
check(readJson(`${claudeDir}/settings.shadow-panel-backup.json`).statusLine.command === "printf '%s' 'MY STATUS'",
    'Claude original settings have a reversible backup');
await connectClaude(settings, '/tmp/test-extension', claudeDir);
check(readJson(`${claudeDir}/settings.json`).statusLine.command === connected.statusLine.command,
    'Repeated Claude connection does not duplicate the bridge');
check(providerForApplication('Gemini - Google Chrome') === 'gemini', 'Browser provider is detected');
check(providerForApplication('Command Code') === 'commandcode', 'Command Code app is detected');
check(providerForProcess('opencode') === 'opencode', 'OpenCode CLI is detected');
check(providerForEntrypoint('/usr/lib/node_modules/@google/gemini-cli/dist/index.js') === 'gemini',
    'Runtime-hosted Gemini CLI is recognized by its entrypoint');
check(providerForProcess('codex') === null, 'The panel app-server cannot cause false app activity');
settings.added = ['claude', 'gemini', 'opencode'];
settings.hidden = [];
GLib.mkdir_with_parents(`${directory}/123`, 0o700);
GLib.file_set_contents(`${directory}/123/comm`, 'opencode\n');
const appScheduler = new Scheduler(null);
const monitor = new AIActivityMonitor(settings, appScheduler, () => [{application: 'Gemini', focused: true}], {procRoot: directory});
monitor.start();
await monitor.refresh();
check(monitor.getState().openIds.includes('opencode') && monitor.getState().focusedId === 'gemini',
    'Open CLI and focused app contribute to provider activity');
monitor.destroy();
check(!appScheduler._sources.has('ai-applications'), 'App polling stops on teardown');
appScheduler.destroy();
for (const file of ['keys/deepseek.key', 'claude/settings.json', 'claude/settings.shadow-panel-backup.json', '123/comm'])
    Gio.File.new_for_path(`${directory}/${file}`).delete(null);
for (const folder of ['keys', 'claude', '123']) Gio.File.new_for_path(`${directory}/${folder}`).delete(null);
Gio.File.new_for_path(path).delete(null);
Gio.File.new_for_path(directory).delete(null);
print(`AI provider tests passed (${assertions} assertions)`);

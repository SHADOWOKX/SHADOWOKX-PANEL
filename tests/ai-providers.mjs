import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {normalizeUsage, usageTaskActive} from '../modules/ai/normalize.js';
import {visibleModules, chooseInitialModule} from '../lib/moduleConfig.js';
import {AIProvider} from '../modules/ai/provider.js';
import {AIActivityMonitor, providerForApplication, providerForProcess, providerForEntrypoint} from '../services/aiActivity.js';
import {isCommandCodeApplication, commandCodeProcessRole} from '../lib/commandCodeIdentity.js';
import {connectClaude, connectUsageFile, saveDeepseekKey} from '../modules/ai/connections.js';
import {Scheduler} from '../services/scheduler.js';
import {CommandCodeTaskMonitor} from '../services/commandCodeTasks.js';

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
check(providerForProcess('cmdc') === null, 'Bare cmdc is never Command Code without a signature');
check(providerForProcess('cmd') === null, 'Bare cmd is never Command Code');
check(providerForEntrypoint('/usr/lib/node_modules/@google/gemini-cli/dist/index.js') === 'gemini',
    'Runtime-hosted Gemini CLI is recognized by its entrypoint');
check(providerForProcess('codex') === null, 'The panel app-server cannot cause false app activity');
check(providerForProcess('command-code') === 'commandcode', 'Command Code Desktop process is detected');
check(providerForProcess('electron') === null, 'Generic Electron host is not Command Code by itself');
check(providerForProcess('cmake') === null, 'A "cmd"-prefixed tool is never misclassified');
check(providerForEntrypoint('/usr/lib/node_modules/command-code/dist/cli.mjs') === 'commandcode',
    'npm Command Code CLI entrypoint is detected');
check(isCommandCodeApplication({appId: 'command-code'}), 'GNOME app id identifies Command Code Desktop');
check(isCommandCodeApplication({wmClass: 'command-code'}), 'StartupWMClass identifies Command Code Desktop');
check(isCommandCodeApplication({desktopId: 'command-code.desktop'}), 'Desktop file id identifies Command Code Desktop');
check(isCommandCodeApplication({executable: '/opt/Command Code/command-code'}),
    'Installed desktop executable is identified');
check(isCommandCodeApplication({executable: '/usr/bin/electron',
    argv: ['/usr/bin/electron', '--app-path=/opt/Command Code/resources/app']}),
    'Electron app bundle argument identifies Command Code Desktop');
check(isCommandCodeApplication({executable: '/usr/bin/electron',
    argv: ['/usr/bin/electron', '--user-data-dir=/data/config/Command Code']}),
    'Electron data directory identifies Command Code Desktop');
check(!isCommandCodeApplication({executable: '/usr/bin/electron',
    argv: ['/usr/bin/electron', '--app-path=/opt/OtherApp/resources/app']}),
    'Unrelated Electron app is not Command Code');
check(!isCommandCodeApplication({executable: '/usr/bin/git-commit'}),
    'Unrelated command-line tool is not Command Code');
// --- CommandCode process roles ---
check(commandCodeProcessRole({comm: 'command-code', executable: '/opt/Command Code/command-code',
    argv: ['/opt/Command Code/command-code']}) === 'desktop-main', 'Desktop main process is main');
check(commandCodeProcessRole({comm: 'command-code', executable: '/opt/Command Code/command-code',
    argv: ['/opt/Command Code/command-code', '--type=renderer']}) === 'desktop-helper',
    'Electron renderer helper is not the main process');
check(commandCodeProcessRole({comm: 'command-code', executable: '/opt/Command Code/command-code',
    argv: ['/opt/Command Code/command-code --type=gpu-process']}) === 'desktop-helper',
    'Space-joined Electron helper cmdline is still a helper');
check(commandCodeProcessRole({comm: 'cmd', executable: '/usr/bin/cmd', argv: ['/usr/bin/cmd']}) === null,
    'Unrelated executable named cmd does not match');
check(commandCodeProcessRole({comm: 'cmd', executable: '/usr/lib/node_modules/command-code/dist/cli.mjs',
    argv: ['/usr/bin/cmd', '/usr/lib/node_modules/command-code/dist/cli.mjs']}) === 'cli',
    'cmd backed by the Command Code install is the CLI');
check(commandCodeProcessRole({comm: 'node', executable: '/usr/bin/node',
    argv: ['/usr/bin/node', '/usr/lib/node_modules/command-code/dist/cli.mjs']}) === 'cli',
    'Runtime-hosted Command Code CLI is detected');
check(commandCodeProcessRole({comm: 'node', executable: '/usr/bin/node',
    argv: ['/usr/bin/node', '/usr/lib/node_modules/@anthropic-ai/claude-code/cli.mjs']}) === null,
    'Another runtime CLI is not Command Code');
check(commandCodeProcessRole({comm: 'electron', executable: '/usr/bin/electron',
    argv: ['/usr/bin/electron', '--app-path=/opt/Command Code/resources/app']}) === 'desktop-main',
    'Generic Electron host running the Command Code bundle is the desktop app');
check(commandCodeProcessRole({comm: 'electron', executable: '/usr/bin/electron',
    argv: ['/usr/bin/electron', '--app-path=/opt/OtherApp/resources/app']}) === null,
    'Unrelated Electron app is not Command Code');

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

// --- CommandCode evidence: only a visible window, desktop main process or CLI ---
settings.added = ['commandcode'];
settings.hidden = [];
const makeProc = (name, entries) => {
    const root = `${directory}/${name}`;
    GLib.mkdir_with_parents(root, 0o700);
    for (const [pid, {comm, cmdline}] of Object.entries(entries)) {
        GLib.mkdir_with_parents(`${root}/${pid}`, 0o700);
        GLib.file_set_contents(`${root}/${pid}/comm`, `${comm}\n`);
        if (cmdline !== undefined)
            GLib.file_set_contents(`${root}/${pid}/cmdline`, new TextEncoder().encode(cmdline));
    }
    return root;
};
const monitorState = async (root, windows = () => []) => {
    const scheduler = new Scheduler(null);
    const instance = new AIActivityMonitor(settings, scheduler, windows, {procRoot: root});
    await instance.refresh();
    const state = instance.getState();
    instance.destroy();
    scheduler.destroy();
    return state;
};

const desktopRoot = makeProc('proc-desktop', {
    100: {comm: 'command-code', cmdline: '/opt/Command Code/command-code\0'},
    101: {comm: 'command-code', cmdline: '/opt/Command Code/command-code\0--type=renderer\0'},
});
let liveState = await monitorState(desktopRoot);
check(liveState.openIds.join(',') === 'commandcode' && liveState.commandCodeSource === 'main-process',
    'Real desktop main process activates the mascot');
// Main process exits; only a helper lingers -> the stale CommandCode ID clears.
Gio.File.new_for_path(`${desktopRoot}/100/comm`).delete(null);
Gio.File.new_for_path(`${desktopRoot}/100/cmdline`).delete(null);
Gio.File.new_for_path(`${desktopRoot}/100`).delete(null);
liveState = await monitorState(desktopRoot);
check(liveState.openIds.length === 0 && liveState.commandCodeSource === 'electron-helper',
    'Stale CommandCode ID disappears and a helper alone stays idle');

const helperRoot = makeProc('proc-helper', {
    200: {comm: 'command-code',
        cmdline: '/opt/Command Code/command-code\0--type=utility\0--utility-sub-type=audio.mojom.AudioService\0'},
});
liveState = await monitorState(helperRoot);
check(liveState.openIds.length === 0 && liveState.commandCodeSource === 'electron-helper',
    'Helper-only Electron processes never activate');
liveState = await monitorState(helperRoot, () => [{application: 'command-code', focused: false, visible: false}]);
check(liveState.openIds.length === 0, 'A hidden CommandCode window is not an open session');

const cmdRoot = makeProc('proc-cmd', {300: {comm: 'cmd', cmdline: '/usr/bin/cmd\0'}});
liveState = await monitorState(cmdRoot);
check(liveState.openIds.length === 0 && liveState.commandCodeSource === 'none',
    'Unrelated executable named cmd does not activate');

const cliRoot = makeProc('proc-cli', {
    400: {comm: 'node', cmdline: '/usr/bin/node\0/usr/lib/node_modules/command-code/dist/cli.mjs\0'},
});
liveState = await monitorState(cliRoot);
check(liveState.openIds.join(',') === 'commandcode' && liveState.commandCodeSource === 'cli',
    'Real Command Code CLI activates the mascot');

liveState = await monitorState(makeProc('proc-window', {}),
    () => [{application: 'command-code', focused: true, visible: true}]);
check(liveState.openIds.join(',') === 'commandcode' && liveState.commandCodeSource === 'desktop-app',
    'A visible CommandCode window activates the desktop app');

// --- CommandCodeTaskMonitor: real in-flight turn signal, not presence ---
const taskDir = `${directory}/tasks`;
GLib.mkdir_with_parents(taskDir, 0o700);
const taskLog = `${taskDir}/main.log`;
const inertScheduler2 = {every() {}, cancel() {}};
const stamp = offsetMs => {
    const date = new Date(Date.now() + offsetMs);
    const pad = (value, width = 2) => String(value).padStart(width, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
        pad(date.getMilliseconds(), 3);
};
const runLine = id => `[${stamp(0)}] [info]  ` +
    `[send] turn running {"sessionId":"${id}","chars":1,"images":0}\n`;
const doneLine = (id, reason = 'end_turn', offsetMs = 1000) => `[${stamp(offsetMs)}] [info]  ` +
    `[send] turn resolved {"sessionId":"${id}","stopReason":"${reason}","pendingSteers":[]}\n`;
const setTaskLog = async (monitor, content) => {
    GLib.file_set_contents(taskLog, content);
    monitor._offset = 0;
    monitor._pending = new Uint8Array(0);
    await monitor.refresh();
    return monitor.getState();
};

const tasks = new CommandCodeTaskMonitor(inertScheduler2, {logPath: taskLog});
tasks.setApplicationOpen(true);
check((await setTaskLog(tasks, '')).busy === false, 'No turn in the log means no task');
let taskState = await setTaskLog(tasks, runLine('a'));
check(taskState.busy === true && taskState.source === 'desktop-turn' && Number.isFinite(taskState.startedAt),
    'A running turn marks Command Code busy');
taskState = await setTaskLog(tasks, runLine('a') + runLine('b'));
check(taskState.busy === true, 'Two concurrent turns keep Command Code busy');
taskState = await setTaskLog(tasks, runLine('a') + runLine('b') + doneLine('a'));
check(taskState.busy === true, 'One remaining turn stays busy');
taskState = await setTaskLog(tasks, runLine('a') + runLine('b') + doneLine('a') + doneLine('b'));
check(taskState.busy === false, 'Resolving every turn returns to idle');
check((await setTaskLog(tasks, runLine('c') + doneLine('c', 'interrupted'))).busy === false,
    'A cancelled turn clears busy');
check((await setTaskLog(tasks, runLine('d') + doneLine('d', 'run_error'))).busy === false,
    'A failed turn clears busy');
check((await setTaskLog(tasks, runLine('e'))).busy === true, 'Turn in flight before close');
tasks.setApplicationOpen(false);
check(tasks.getState().busy === false && tasks.getState().source === null,
    'Closing the application clears an in-flight turn');

// Incremental append across polls (no re-read of the whole file).
GLib.file_set_contents(taskLog, runLine('x'));
const incremental = new CommandCodeTaskMonitor(inertScheduler2, {logPath: taskLog});
incremental.setApplicationOpen(true);
await incremental.refresh();
check(incremental.getState().busy === true, 'Incremental read sees the running turn');
GLib.file_set_contents(taskLog, runLine('x') + doneLine('x'));
await incremental.refresh();
check(incremental.getState().busy === false, 'Incremental read sees the terminal line');

// A lost turn (app killed) expires instead of sticking busy forever.
const expiring = new CommandCodeTaskMonitor(inertScheduler2, {logPath: taskLog, maxTaskMs: 1000});
expiring.setApplicationOpen(true);
const oldLine = `[${stamp(-2 * 60 * 60 * 1000)}] [info]  ` +
    `[send] turn running {"sessionId":"f","chars":1,"images":0}\n`;
check((await setTaskLog(expiring, oldLine)).busy === false,
    'A lost turn expires instead of keeping the mascot busy');

// Log truncation/rotation clears stale state (no offset reset, real rotation).
const rotating = new CommandCodeTaskMonitor(inertScheduler2, {logPath: taskLog});
rotating.setApplicationOpen(true);
GLib.file_set_contents(taskLog, runLine('g'));
await rotating.refresh();
check(rotating.getState().busy === true, 'Turn before log rotation');
GLib.file_set_contents(taskLog, '');
await rotating.refresh();
check(rotating.getState().busy === false, 'Log rotation clears a stale turn');

const removeTree = filePath => {
    const file = Gio.File.new_for_path(filePath);
    let enumerator;
    try {
        enumerator = file.enumerate_children('standard::name,standard::type',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch { return; }
    let info;
    while ((info = enumerator.next_file(null))) {
        const child = `${filePath}/${info.get_name()}`;
        if (info.get_file_type() === Gio.FileType.DIRECTORY) removeTree(child);
        else Gio.File.new_for_path(child).delete(null);
    }
    enumerator.close(null);
    try { file.delete(null); } catch {}
};
removeTree(directory);
print(`AI provider tests passed (${assertions} assertions)`);

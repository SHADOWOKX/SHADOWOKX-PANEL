import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {commandCodeStatus, commandCodeMessage, parseCommandCodeStatus, COMMANDCODE_INTERVAL} from '../modules/ai/commandcode.js';
import {AIProvider} from '../modules/ai/provider.js';
import {COMMANDCODE_USAGE_URL, GOAT_REFERENCE} from '../lib/commandcodeReference.js';
import {normalizeUsage} from '../modules/ai/normalize.js';

function check(value, message) { if (!value) throw new Error(message); }
check(COMMANDCODE_INTERVAL === 180, 'Three-minute refresh');
check(COMMANDCODE_USAGE_URL === 'https://commandcode.ai/usage', 'Usage action opens the official human-facing page');
check(Object.isFrozen(GOAT_REFERENCE) && !('usedPercent' in GOAT_REFERENCE) && !('resetsAt' in GOAT_REFERENCE),
    'Plan reference has no live consumption or reset timestamp');
let rejected = false;
try { normalizeUsage(GOAT_REFERENCE, 'commandcode'); } catch { rejected = true; }
check(rejected, 'Published plan reference cannot be parsed as account usage');
for (const [raw, expected] of [[{authenticated: true}, 'authenticated'], [{authenticated: false}, 'signed-out'],
    [{authenticated: true, error: 'private-key'}, 'error'], [{authenticated: 'true'}, 'unsupported'],
    [{balance: 10, tokens: 100}, 'unsupported']]) {
    const result = parseCommandCodeStatus(JSON.stringify({...raw, apiKey: 'private-key'}));
    check(result === expected, 'Only documented authentication is parsed');
    check(!commandCodeMessage(result).includes('private-key'), 'Secrets cannot reach diagnostics');
}
check(parseCommandCodeStatus('{private-key') === 'unsupported', 'Malformed output is safe');
const directory = GLib.dir_make_tmp('commandcode-tests-XXXXXX');
const executable = `${directory}/cmdc`;
const script = body => { GLib.file_set_contents(executable, `#!/bin/sh\n${body}\n`);
    Gio.File.new_for_path(executable).set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NONE, null); };
script('test "$1" = status && test "$2" = --json || exit 2\nprintf \'{"authenticated":true,"apiKey":"private-key"}\'');
check(await commandCodeStatus(null, executable) === 'authenticated', 'Asynchronous CLI discovery');
script('printf \'{"authenticated":false}\'; exit 1');
check(await commandCodeStatus(null, executable) === 'signed-out', 'Signed-out nonzero exit is parsed');
script('printf private-key >&2; printf invalid; exit 1');
check(await commandCodeStatus(null, executable) === 'unsupported', 'stderr and malformed replies are suppressed');
script('exec sleep 20');
check(await commandCodeStatus(null, executable, 1) !== 'authenticated', 'Hung CLI times out');
const cancelled = new Gio.Cancellable(); cancelled.cancel();
check(await commandCodeStatus(cancelled, executable) === 'error', 'Cancellation stops processes');
check(await commandCodeStatus(null, `${directory}/missing`) === 'error', 'Missing executable is safe');
script('yes x | head -c 20000');
check(await commandCodeStatus(null, executable) === 'unsupported', 'Output is bounded');
let interval;
const scheduler = {every(_id, seconds) { interval = seconds; }, cancel() {}};
const settings = {get_string() { return '{}'; }, connect() { return 1; }, disconnect() {}};
const provider = new AIProvider('commandcode', settings, scheduler);
let calls = 0;
provider._read = async () => { calls++; throw new Error(commandCodeMessage('authenticated')); };
await provider.start();
check(interval === 180 && provider.getState().status === 'unavailable' && !provider.getState().data,
    'Authenticated account never implies allowance');
const first = provider.refresh(); const second = provider.refresh();
check(first === second, 'Overlapping manual and scheduled refreshes coalesce');
await first;
check(calls === 2, 'Manual refresh retries');
provider.destroy(); await provider.refresh(); check(calls === 2, 'Shutdown stops refresh');
Gio.File.new_for_path(executable).delete(null); Gio.File.new_for_path(directory).delete(null);
print('Command Code authentication, refresh, cancellation and privacy tests passed.');

// Explicit opt-in authenticated verification, never part of offline npm tests.
// No input credentials, raw responses, account identifiers or remote errors printed.
import {lookupCommandCodeKey} from '../modules/ai/commandcodeCredentials.js';
import {CommandCodeApi} from '../modules/ai/commandcodeApi.js';
import {CommandCodeError} from '../lib/commandcodeUsage.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {AIProvider} from '../modules/ai/provider.js';
import {Scheduler} from '../services/scheduler.js';

const api = new CommandCodeApi();
let provider;
const poll = ARGV.includes('--poll');
const scheduler = new Scheduler(null);
try {
    let key = await lookupCommandCodeKey();
    if (!key) throw new CommandCodeError('authentication-required');
    const paths = ['/alpha/whoami', '/alpha/billing/credits', '/alpha/billing/subscriptions', '/alpha/usage/summary'];
    const shapes = [];
    const original = api._get.bind(api);
    function shape(value, depth = 0) {
        if (depth > 5) return 'object';
        if (Array.isArray(value)) return {array: value.length ? shape(value[0], depth + 1) : 'empty'};
        if (value !== null && typeof value === 'object') {
            const result = {};
            for (const [name, child] of Object.entries(value)) {
                if (!/^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(name) || name.includes(key) || /api.?key|secret|authorization|password/i.test(name)) continue;
                result[name] = shape(child, depth + 1);
            }
            return result;
        }
        return value === null ? 'null' : typeof value; // Even benign strings are not exported.
    }
    api._get = async (path, token, cancellable) => {
        const raw = await original(path, token, cancellable);
        shapes.push({endpoint: paths.find(p => path.split('?')[0] === p), httpStatus: 200, structure: shape(raw)});
        return raw;
    };
    const directory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_path();
    const schemas = Gio.SettingsSchemaSource.new_from_directory(`${directory}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: schemas.lookup('org.gnome.shell.extensions.shadow-panel', false)});
    let interval;
    provider = new AIProvider('commandcode', settings, {every(name, seconds, callback) {
        interval = seconds;
        if (poll) scheduler.every(name, seconds, callback);
    }, cancel(name) { scheduler.cancel(name); }}, {commandCodeApi: api});
    await provider.start();
    const state = provider.getState();
    if (state.data?.source !== 'commandcode-api') throw new CommandCodeError(state.errorCode ?? 'api-changed');
    const data = state.data;
    key = null;
    print(JSON.stringify({authenticated: true, providerStatus: state.status, refreshSeconds: interval, shapes, metrics: {plan: data.plan, planStatus: data.planStatus,
        windows: data.windows, creditBalances: data.creditBalances, consumption: data.consumption,
        warnings: data.warnings, updatedAt: data.updatedAt}}));
    if (poll) {
        await new Promise((resolve, reject) => {
            let deadline;
            const disconnect = provider.subscribe(next => {
                if (next.refreshing || !next.data || next.data.updatedAt <= data.updatedAt) return;
                if (deadline) GLib.Source.remove(deadline);
                disconnect();
                print(JSON.stringify({automaticRefresh: true, providerStatus: next.status,
                    elapsedSeconds: Math.round((next.data.updatedAt - data.updatedAt) / 1000),
                    updatedAt: next.data.updatedAt, plan: next.data.plan, requests: next.data.consumption.requests}));
                resolve();
            });
            deadline = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 240, () => {
                deadline = 0;
                disconnect();
                reject(new CommandCodeError('timeout'));
                return GLib.SOURCE_REMOVE;
            });
        });
    }
} catch (error) {
    print(JSON.stringify({authenticated: false, code: error instanceof CommandCodeError ? error.code : 'verification-failed'}));
    imports.system.exit(1);
} finally { provider?.destroy(); scheduler.destroy(); api.destroy(); }

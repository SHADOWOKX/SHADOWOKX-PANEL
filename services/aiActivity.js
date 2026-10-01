import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {AI_IDS} from '../lib/constants.js';
import {visibleModules} from '../lib/moduleConfig.js';
import {Observable} from './observable.js';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');
Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'read_async', 'read_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');

export function providerForApplication(name) {
    const text = String(name ?? '').toLowerCase();
    for (const [id, pattern] of [
        ['commandcode', /\b(command[- ]?code|cmdc)\b/], ['opencode', /\bopencode\b/],
        ['claude', /\bclaude\b/], ['codex', /\bcodex\b/], ['deepseek', /\bdeepseek\b/],
        ['gemini', /\bgemini\b/], ['glm', /\b(z\.ai|glm)\b/],
    ]) {
        if (pattern.test(text)) return id;
    }
    return null;
}

export function providerForProcess(name) {
    const text = String(name ?? '').trim().toLowerCase();
    // Codex activity comes from its session monitor and app windows. The
    // panel's own app-server must never be mistaken for a user's open client.
    return ({claude: 'claude', opencode: 'opencode', 'command-code': 'commandcode',
        commandcode: 'commandcode', cmdc: 'commandcode', gemini: 'gemini'})[text] ?? null;
}

export function providerForEntrypoint(path) {
    const direct = providerForProcess(GLib.path_get_basename(path || ''));
    if (direct) return direct;
    for (const [id, pattern] of [
        ['claude', /\/@anthropic-ai\/claude-code\//],
        ['gemini', /\/@google\/gemini-cli\//],
        ['commandcode', /\/command-code\//], ['opencode', /\/opencode-ai\//],
    ]) if (pattern.test(path)) return id;
    return null;
}

export class AIActivityMonitor extends Observable {
    constructor(settings, scheduler, windows = () => [], options = {}) {
        super({openIds: [], focusedId: null});
        this._settings = settings;
        this._scheduler = scheduler;
        this._windows = windows;
        this._procRoot = options.procRoot ?? '/proc';
        this._destroyed = false;
        this._cancellable = new Gio.Cancellable();
        this._inFlight = null;
    }

    start() {
        this._scheduler.every('ai-applications', 3, () => this.refresh(), true);
    }

    refresh() {
        if (this._destroyed) return Promise.resolve();
        if (this._inFlight) return this._inFlight;
        this._inFlight = this._read().finally(() => { this._inFlight = null; });
        return this._inFlight;
    }

    async _read() {
        const allowed = visibleModules(this._settings).filter(id => AI_IDS.includes(id));
        const ids = new Set();
        let focusedId = null;
        for (const window of this._windows()) {
            const id = providerForApplication(window.application);
            if (id && allowed.includes(id)) {
                ids.add(id);
                if (window.focused) focusedId = id;
            }
        }
        let enumerator;
        try {
            enumerator = await Gio.File.new_for_path(this._procRoot).enumerate_children_async(
                'standard::name,owner::user', Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_LOW, this._cancellable);
            while (!this._destroyed) {
                const files = await enumerator.next_files_async(64, GLib.PRIORITY_LOW, this._cancellable);
                if (!files.length) break;
                await Promise.all(files.filter(info => /^\d+$/.test(info.get_name()) &&
                    info.get_attribute_string('owner::user') === GLib.get_user_name()).map(async info => {
                    try {
                        const [bytes] = await Gio.File.new_for_path(GLib.build_filenamev([
                            this._procRoot, info.get_name(), 'comm',
                        ])).load_contents_async(this._cancellable);
                        const name = new TextDecoder().decode(bytes).trim();
                        let id = providerForProcess(name);
                        if (!id && /^(node|bun|python3?)$/.test(name)) {
                            const stream = await Gio.File.new_for_path(GLib.build_filenamev([
                                this._procRoot, info.get_name(), 'cmdline',
                            ])).read_async(GLib.PRIORITY_LOW, this._cancellable);
                            try {
                                const header = await stream.read_bytes_async(8192, GLib.PRIORITY_LOW, this._cancellable);
                                // Only inspect the runtime and entrypoint, never prompts or credentials.
                                const args = new TextDecoder().decode(header.toArray()).split('\0', 2);
                                id = providerForEntrypoint(args[1] ?? args[0]);
                            } finally { stream.close(null); }
                        }
                        if (id && allowed.includes(id)) ids.add(id);
                    } catch { /* A process can exit between enumeration and reading. */ }
                }));
            }
        } catch { /* Window detection still works when procfs is unavailable. */ }
        finally { try { enumerator?.close(null); } catch {} }
        if (this._destroyed) return;
        const next = {openIds: allowed.filter(id => ids.has(id)), focusedId};
        if (JSON.stringify(next) !== JSON.stringify(this.getState())) this._setState(next);
    }

    destroy() {
        this._destroyed = true;
        this._cancellable.cancel();
        this._scheduler.cancel('ai-applications');
        super.destroy();
    }
}

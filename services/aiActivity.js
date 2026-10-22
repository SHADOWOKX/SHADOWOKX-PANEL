import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {AI_IDS} from '../lib/constants.js';
import {isCommandCodeApplication, isCommandCodeCandidate, commandCodeProcessRole, isGenericDesktopHost}
    from '../lib/commandCodeIdentity.js';
import {visibleModules} from '../lib/moduleConfig.js';
import {Observable} from './observable.js';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');
Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'read_async', 'read_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');

export function providerForApplication(name) {
    const text = String(name ?? '').toLowerCase();
    if (isCommandCodeApplication({appId: text, wmClass: text, desktopId: text}))
        return 'commandcode';
    for (const [id, pattern] of [
        ['opencode', /\bopencode\b/], ['claude', /\bclaude\b/], ['codex', /\bcodex\b/],
        ['deepseek', /\bdeepseek\b/], ['gemini', /\bgemini\b/], ['glm', /\b(z\.ai|glm)\b/],
    ]) {
        if (pattern.test(text)) return id;
    }
    return null;
}

export function providerForProcess(name) {
    const text = String(name ?? '').trim().toLowerCase();
    // Codex activity comes from its session monitor and app windows. The
    // panel's own app-server must never be mistaken for a user's open client.
    // Only the exact desktop binary names are matched here; "cmd"/"cmdc" are
    // too generic and require a strong signature (commandCodeProcessRole).
    if (text === 'command-code' || text === 'commandcode') return 'commandcode';
    return ({claude: 'claude', opencode: 'opencode', gemini: 'gemini'})[text] ?? null;
}

export function providerForEntrypoint(path) {
    const direct = providerForProcess(GLib.path_get_basename(path || ''));
    if (direct) return direct;
    if (isCommandCodeApplication({executable: path || ''})) return 'commandcode';
    for (const [id, pattern] of [
        ['claude', /\/@anthropic-ai\/claude-code\//],
        ['gemini', /\/@google\/gemini-cli\//],
        ['opencode', /\/opencode-ai\//],
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
        this._commandCodeSignature = null;
        this._unmappedCommandCodeSignature = null;
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

    async _readCommandLine(pid) {
        const stream = await Gio.File.new_for_path(GLib.build_filenamev([
            this._procRoot, pid, 'cmdline',
        ])).read_async(GLib.PRIORITY_LOW, this._cancellable);
        try {
            const header = await stream.read_bytes_async(8192, GLib.PRIORITY_LOW, this._cancellable);
            // Only the runtime/entrypoint and launcher arguments are inspected,
            // never prompts, credentials or environment contents. Electron
            // rewrites helper cmdlines with spaces, so callers must also match
            // against the whole string, not just NUL-separated tokens.
            return new TextDecoder().decode(header.toArray()).split('\0').filter(Boolean);
        } finally { stream.close(null); }
    }

    // The real executable behind /proc/<pid>/exe, independent of a rewritten
    // Chromium command line. Diagnostic only.
    _readExecutable(pid) {
        try {
            return GLib.file_read_link(GLib.build_filenamev([this._procRoot, pid, 'exe']));
        } catch { return null; }
    }

    async _read() {
        const allowed = visibleModules(this._settings).filter(id => AI_IDS.includes(id));
        const ids = new Set();
        let focusedId = null;
        let desktopWindow = false;
        const commandCodeWindowIds = new Set();
        for (const window of this._windows()) {
            const id = providerForApplication(window.application);
            if (!id || !allowed.includes(id)) continue;
            if (id === 'commandcode') {
                // A hidden/minimized window is not a user-facing session.
                if (window.visible === false) continue;
                desktopWindow = true;
                if (window.application) commandCodeWindowIds.add(String(window.application));
                if (window.focused) focusedId = 'commandcode';
                continue;
            }
            ids.add(id);
            if (window.focused) focusedId = id;
        }

        let mainProcess = false;
        let cli = false;
        let helper = false;
        const details = {main: null, cli: null, helper: null};
        let unmappedCommandCode = null;
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
                        const pid = info.get_name();
                        const [bytes] = await Gio.File.new_for_path(GLib.build_filenamev([
                            this._procRoot, pid, 'comm',
                        ])).load_contents_async(this._cancellable);
                        const name = new TextDecoder().decode(bytes).trim();
                        // Command line / resolved executable are read only for processes
                        // that could be Command Code, a runtime CLI or an Electron host.
                        const candidate = /^(command-code|commandcode|cmd|cmdc)$/i.test(name) ||
                            /^(node|bun|python3?)$/.test(name) || isGenericDesktopHost(name);
                        let argv = null;
                        let executable = null;
                        if (candidate) {
                            executable = this._readExecutable(pid);
                            try { argv = await this._readCommandLine(pid); } catch { argv = null; }
                        }
                        const role = commandCodeProcessRole({
                            comm: name, executable: executable ?? name, argv: argv ?? [],
                        });
                        if (role === 'desktop-main') {
                            mainProcess = true;
                            details.main ??= {kind: role, comm: name, executable: executable ?? name, argv: argv ?? []};
                        } else if (role === 'cli') {
                            cli = true;
                            details.cli ??= {kind: role, comm: name, executable: executable ?? name, argv: argv ?? []};
                        } else if (role === 'desktop-helper') {
                            helper = true;
                            details.helper ??= {kind: role, comm: name, executable: executable ?? name, argv: argv ?? []};
                        } else {
                            const id = providerForProcess(name) ||
                                (argv?.length ? providerForEntrypoint(argv[0]) : null);
                            if (id && id !== 'commandcode' && allowed.includes(id)) {
                                ids.add(id);
                            } else if (!id && isCommandCodeCandidate({executable: executable ?? name, argv: argv ?? []})) {
                                unmappedCommandCode ??= {pid, comm: name,
                                    executable: executable ?? name, argv: argv ?? []};
                            }
                        }
                    } catch { /* A process can exit between enumeration and reading. */ }
                }));
            }
        } catch { /* Window detection still works when procfs is unavailable. */ }
        finally { try { enumerator?.close(null); } catch {} }

        // Evidence-based: only a visible desktop window, the desktop main process
        // or a strongly identified CLI count. Electron helpers never do.
        const desktopApp = desktopWindow;
        const active = desktopApp || mainProcess || cli;
        const helperOnly = !active && helper;
        const commandCodeSource = desktopApp ? 'desktop-app'
            : mainProcess ? 'main-process'
            : cli ? 'cli'
            : helperOnly ? 'electron-helper' : 'none';
        if (active) ids.add('commandcode');

        const commandCodeProcess = details.main ?? details.cli ?? details.helper;
        this._logCommandCodeDetection({
            commandCodeWindowIds: [...commandCodeWindowIds], commandCodeProcess, unmappedCommandCode,
        });
        if (this._destroyed) return;
        const previous = this.getState()?.openIds ?? [];
        const current = allowed.filter(id => ids.has(id));
        const next = {openIds: current, focusedId, commandCodeSource};
        if (JSON.stringify(next) !== JSON.stringify(this.getState())) {
            // Log the set transition first, then publish so the panel's derived
            // logs (source / provider state / mascot) follow it in order.
            if (JSON.stringify(current) !== JSON.stringify(previous))
                console.warn(`[AIActivity] openIds changed: ${JSON.stringify(previous)} -> ${JSON.stringify(current)}`);
            this._setState(next);
        }
    }

    // Transition-only diagnostics: silent during a quiet 3-second poll.
    _logCommandCodeDetection({commandCodeWindowIds, commandCodeProcess, unmappedCommandCode}) {
        if (commandCodeProcess || commandCodeWindowIds.length) {
            const signature = JSON.stringify({
                ids: commandCodeWindowIds,
                kind: commandCodeProcess?.kind ?? null,
                executable: commandCodeProcess?.executable ?? null,
            });
            if (signature !== this._commandCodeSignature) {
                this._commandCodeSignature = signature;
                if (commandCodeWindowIds.length)
                    console.warn(`[CommandCode] window: appId ${commandCodeWindowIds.join(', ')}`);
                if (commandCodeProcess) {
                    console.warn(`[CommandCode] process: ${commandCodeProcess.kind} · ${commandCodeProcess.executable}`);
                    if (commandCodeProcess.argv?.length)
                        console.warn(`[CommandCode] argv: ${commandCodeProcess.argv.join(' ')}`);
                }
            }
        } else {
            this._commandCodeSignature = null;
        }
        if (unmappedCommandCode) {
            const signature = `${unmappedCommandCode.comm}|${unmappedCommandCode.executable}`;
            if (signature !== this._unmappedCommandCodeSignature) {
                this._unmappedCommandCodeSignature = signature;
                console.warn(`[CommandCode] desktop candidate not mapped: ${JSON.stringify(unmappedCommandCode)}`);
            }
        } else {
            this._unmappedCommandCodeSignature = null;
        }
    }

    destroy() {
        this._destroyed = true;
        this._cancellable.cancel();
        this._scheduler.cancel('ai-applications');
        super.destroy();
    }
}

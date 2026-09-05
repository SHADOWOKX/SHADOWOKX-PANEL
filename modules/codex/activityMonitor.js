import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Observable} from '../../services/observable.js';

export const CODEX_ACTIVITY_GRACE_MS = 6000;
export const CODEX_SESSION_TAIL_BYTES = 128 * 1024;

const ACTIVITY_EVENT_TYPES = new Set([
    'task_started',
    'item_completed',
    'agent_reasoning',
    'agent_message',
    'token_count',
]);

const TERMINAL_EVENT_TYPES = new Set([
    'task_complete',
    'turn_aborted',
]);

const ACTIVITY_RESPONSE_TYPES = new Set([
    'reasoning',
    'function_call',
    'function_call_output',
    'custom_tool_call',
    'custom_tool_call_output',
]);

function eventTimestamp(record) {
    const timestamp = Date.parse(record?.timestamp ?? '');
    return Number.isFinite(timestamp) ? timestamp : null;
}

export function parseCodexSessionActivity(text) {
    const events = [];
    for (const line of String(text ?? '').split('\n')) {
        if (!line.trim())
            continue;
        let record;
        try {
            record = JSON.parse(line);
        } catch {
            continue;
        }

        if (record?.type === 'event_msg') {
            const type = record.payload?.type;
            if (ACTIVITY_EVENT_TYPES.has(type)) {
                events.push({
                    kind: type === 'task_started' ? 'start' : 'activity',
                    type,
                    turnId: record.payload?.turn_id ?? null,
                    timestamp: eventTimestamp(record),
                });
            } else if (TERMINAL_EVENT_TYPES.has(type)) {
                events.push({
                    kind: 'terminal',
                    type,
                    turnId: record.payload?.turn_id ?? null,
                    timestamp: eventTimestamp(record),
                });
            }
            continue;
        }

        if (record?.type === 'token_usage_record') {
            events.push({
                kind: 'activity',
                type: 'token_usage_record',
                turnId: record.turn_id ?? record.payload?.turn_id ?? null,
                timestamp: eventTimestamp(record),
            });
            continue;
        }

        if (record?.type === 'response_item' &&
            ACTIVITY_RESPONSE_TYPES.has(record.payload?.type)) {
            events.push({
                kind: 'activity',
                type: record.payload.type,
                turnId: record.turn_id ?? record.payload?.turn_id ?? null,
                timestamp: eventTimestamp(record),
            });
        }
    }
    return events;
}

export function codexUsageActivitySignature(state) {
    if (!state || state.status === 'loading' || state.status === 'error')
        return null;
    const buckets = state.tokenUsage?.dailyBuckets;
    const newestBucket = Array.isArray(buckets) ? buckets.at(-1) : null;
    const values = [
        state.tokenUsage?.lifetimeTokens,
        newestBucket?.date,
        newestBucket?.tokens,
        state.fiveHour?.usedPercent,
        state.weekly?.usedPercent,
    ];
    return values.some(value => value !== null && value !== undefined)
        ? JSON.stringify(values)
        : null;
}

function defaultCodexHome() {
    return GLib.getenv('CODEX_HOME') || GLib.build_filenamev([
        GLib.get_home_dir(),
        '.codex',
    ]);
}

function recentSessionDirectories(root) {
    const now = GLib.DateTime.new_now_local();
    return [now, now.add_days(-1)].map(date => GLib.build_filenamev([
        root,
        date.format('%Y'),
        date.format('%m'),
        date.format('%d'),
    ]));
}

function readChunk(path, offset, maximumBytes) {
    const file = Gio.File.new_for_path(path);
    const info = file.query_info(
        'standard::size,standard::type',
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null
    );
    if (info.get_file_type() !== Gio.FileType.REGULAR)
        return null;
    const size = info.get_size();
    let start = offset > size ? 0 : Math.max(0, offset);
    if (size - start > maximumBytes)
        start = size - maximumBytes;
    const input = file.read(null);
    try {
        input.seek(start, GLib.SeekType.SET, null);
        const bytes = input.read_bytes(size - start, null).get_data();
        return {
            text: new TextDecoder().decode(bytes ?? new Uint8Array(0)),
            start,
            end: size,
        };
    } finally {
        input.close(null);
    }
}

export class CodexActivityMonitor extends Observable {
    constructor(provider, logger, options = {}) {
        super({active: false, source: 'idle', lastActivity: null});
        this._provider = provider;
        this._logger = logger;
        const codexHome = options.codexHome ?? defaultCodexHome();
        this._sessionsRoot = options.sessionsRoot ?? GLib.build_filenamev([
            codexHome,
            'sessions',
        ]);
        this._codexHome = options.sessionsRoot ? null : codexHome;
        this._graceMs = options.graceMs ?? CODEX_ACTIVITY_GRACE_MS;
        this._now = options.now ?? (() => Date.now());
        this._monitors = new Map();
        this._files = new Map();
        this._pendingReads = new Map();
        this._activeTurns = new Set();
        this._providerUnsubscribe = null;
        this._lastUsageSignature = null;
        this._idleId = 0;
        this._started = false;
        this._destroyed = false;
        this._monitorWarningLogged = false;
    }

    start() {
        if (this._started || this._destroyed)
            return;
        this._started = true;
        this._providerUnsubscribe = this._provider?.subscribe(state =>
            this._onProviderState(state)) ?? null;
        this._ensureWatchChain();
    }

    _onProviderState(state) {
        const signature = codexUsageActivitySignature(state);
        if (!signature)
            return;
        // Usage refreshes report completed accounting, not whether a turn is
        // currently generating. Keep the signature for diagnostics, but never
        // wake the mascot from quota/history changes alone.
        this._lastUsageSignature = signature;
    }

    _ensureWatchChain() {
        if (this._destroyed)
            return;
        const sessionDirectories = recentSessionDirectories(this._sessionsRoot);
        const paths = new Set([this._sessionsRoot]);
        if (this._codexHome)
            paths.add(this._codexHome);
        for (const day of sessionDirectories) {
            let current = this._sessionsRoot;
            const relative = day.slice(this._sessionsRoot.length).split('/').filter(Boolean);
            for (const part of relative) {
                current = GLib.build_filenamev([current, part]);
                paths.add(current);
            }
        }
        for (const [path, {monitor, signalId}] of this._monitors) {
            if (paths.has(path))
                continue;
            monitor.disconnect(signalId);
            monitor.cancel();
            this._monitors.delete(path);
        }
        const recentDays = new Set(sessionDirectories);
        for (const path of this._files.keys()) {
            if (!recentDays.has(GLib.path_get_dirname(path))) {
                this._dropTurnsForPath(path);
                this._files.delete(path);
            }
        }
        for (const [path, pending] of this._pendingReads) {
            if (recentDays.has(GLib.path_get_dirname(path)))
                continue;
            GLib.Source.remove(pending.id);
            this._pendingReads.delete(path);
        }
        for (const path of paths)
            this._watchDirectory(path);
        for (const day of sessionDirectories)
            this._scanSessionDirectory(day);
    }

    _watchDirectory(path) {
        if (this._monitors.has(path) ||
            !GLib.file_test(path, GLib.FileTest.IS_DIR))
            return;
        try {
            const monitor = Gio.File.new_for_path(path).monitor_directory(
                Gio.FileMonitorFlags.WATCH_MOVES,
                null
            );
            const signalId = monitor.connect('changed', (_monitor, file, _other, event) => {
                if (this._destroyed)
                    return;
                const changedPath = file?.get_path();
                if (changedPath?.endsWith('.jsonl'))
                    this._queueRead(changedPath);
                if (event === Gio.FileMonitorEvent.CREATED ||
                    event === Gio.FileMonitorEvent.MOVED_IN)
                    this._ensureWatchChain();
            });
            this._monitors.set(path, {monitor, signalId});
        } catch {
            if (!this._monitorWarningLogged) {
                this._monitorWarningLogged = true;
                this._logger?.debug('codex.activity.monitor.unavailable');
            }
        }
    }

    _scanSessionDirectory(path) {
        if (!GLib.file_test(path, GLib.FileTest.IS_DIR))
            return;
        try {
            const enumerator = Gio.File.new_for_path(path).enumerate_children(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                null
            );
            try {
                let info;
                while ((info = enumerator.next_file(null))) {
                    if (info.get_file_type() === Gio.FileType.REGULAR &&
                        info.get_name().endsWith('.jsonl')) {
                        this._queueRead(GLib.build_filenamev([path, info.get_name()]), true);
                    }
                }
            } finally {
                enumerator.close(null);
            }
        } catch {
            // Codex may rotate or remove a session directory while it is scanned.
        }
    }

    _queueRead(path, initial = false) {
        if (this._destroyed)
            return;
        const previous = this._pendingReads.get(path);
        if (previous)
            GLib.Source.remove(previous.id);
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 80, () => {
            this._pendingReads.delete(path);
            this._readSession(path, initial || previous?.initial);
            return GLib.SOURCE_REMOVE;
        });
        this._pendingReads.set(path, {id, initial: initial || previous?.initial});
    }

    _readSession(path, initial = false) {
        if (this._destroyed)
            return;
        const previous = this._files.get(path) ?? {offset: 0, fragment: ''};
        try {
            const chunk = readChunk(path, previous.offset, CODEX_SESSION_TAIL_BYTES);
            if (!chunk)
                return;
            let text = chunk.text;
            let fragment = previous.fragment;
            if (chunk.start !== previous.offset) {
                fragment = '';
                if (chunk.start > 0)
                    text = text.slice(Math.max(0, text.indexOf('\n') + 1));
            }
            text = fragment + text;
            const newline = text.lastIndexOf('\n');
            const complete = newline >= 0 ? text.slice(0, newline + 1) : '';
            fragment = newline >= 0 ? text.slice(newline + 1) : text;
            this._files.set(path, {offset: chunk.end, fragment});

            const recentCutoff = this._now() - this._graceMs;
            for (const event of parseCodexSessionActivity(complete)) {
                if (!initial || event.timestamp === null || event.timestamp >= recentCutoff)
                    this._applySessionEvent(path, event);
            }
        } catch {
            this._dropTurnsForPath(path);
            this._files.delete(path);
        }
    }

    _turnKey(path, turnId) {
        return `${path}\n${turnId ?? '__current__'}`;
    }

    _pathHasActiveTurn(path) {
        const prefix = `${path}\n`;
        for (const key of this._activeTurns) {
            if (key.startsWith(prefix))
                return true;
        }
        return false;
    }

    _dropTurnsForPath(path) {
        const prefix = `${path}\n`;
        for (const key of [...this._activeTurns]) {
            if (key.startsWith(prefix))
                this._activeTurns.delete(key);
        }
    }

    _applySessionEvent(path, event) {
        const key = this._turnKey(path, event.turnId);
        if (event.kind === 'start') {
            this._activeTurns.add(key);
            this._markActivity('session', event.timestamp, true);
            return;
        }
        if (event.kind === 'terminal') {
            if (event.turnId)
                this._activeTurns.delete(key);
            else
                this._dropTurnsForPath(path);
            if (this._activeTurns.size > 0) {
                this._markActivity('session', event.timestamp, true);
            } else {
                if (this._idleId)
                    GLib.Source.remove(this._idleId);
                this._idleId = 0;
                const now = this._now();
                const lastActivity = Number.isFinite(event.timestamp)
                    ? Math.min(now, event.timestamp)
                    : now;
                this._setState({active: false, source: 'idle', lastActivity});
            }
            return;
        }

        // Completion/token records can be appended after a turn is already over.
        // They refresh a live turn, but never resurrect an idle mascot by themselves.
        if (this._pathHasActiveTurn(path)) {
            this._markActivity('session', event.timestamp, true);
        } else if (ACTIVITY_RESPONSE_TYPES.has(event.type)) {
            // A Shell reload may begin tailing after task_started. Direct model/tool
            // response records are still genuine work; give only those a short pulse.
            this._markActivity('session', event.timestamp, false);
        }
    }

    _markActivity(source, timestamp = null, holdUntilTerminal = false) {
        if (this._destroyed)
            return;
        const now = this._now();
        const lastActivity = Number.isFinite(timestamp) ? Math.min(now, timestamp) : now;
        this._setState({active: true, source, lastActivity});
        if (this._idleId)
            GLib.Source.remove(this._idleId);
        this._idleId = 0;
        if (holdUntilTerminal || this._activeTurns.size > 0)
            return;
        const delay = Math.max(1, this._graceMs - Math.max(0, now - lastActivity));
        this._idleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._idleId = 0;
            if (!this._destroyed)
                this._setState({active: false, source: 'idle', lastActivity});
            return GLib.SOURCE_REMOVE;
        });
    }

    stop() {
        if (!this._started)
            return;
        this._started = false;
        if (this._idleId)
            GLib.Source.remove(this._idleId);
        this._idleId = 0;
        for (const {id} of this._pendingReads.values())
            GLib.Source.remove(id);
        this._pendingReads.clear();
        for (const {monitor, signalId} of this._monitors.values()) {
            monitor.disconnect(signalId);
            monitor.cancel();
        }
        this._monitors.clear();
        this._files.clear();
        this._activeTurns.clear();
        this._providerUnsubscribe?.();
        this._providerUnsubscribe = null;
        this._lastUsageSignature = null;
        this._setState({active: false, source: 'idle', lastActivity: null});
    }

    destroy() {
        if (this._destroyed)
            return;
        this.stop();
        this._destroyed = true;
        this._provider = null;
        this._codexHome = null;
        super.destroy();
    }
}

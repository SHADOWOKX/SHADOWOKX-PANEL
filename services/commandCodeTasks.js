// Command Code real task activity for the GNOME panel.
//
// Application presence (desktop window / desktop main process / CLI) is NOT a
// task. This observer watches the one deterministic in-flight signal the
// Command Code Desktop app writes about itself:
//
//   ~/.config/Command Code/logs/main.log   (electron-log, via the app's trace())
//     start:  [send] turn running  {"sessionId":"...","chars":N,"images":N}
//     end:    [send] turn resolved {"sessionId":"...","stopReason":"end_turn|interrupted|run_error"}
//
// The desktop main process emits these in `send()` around `instance.runTurn()`,
// so one user turn (including every tool call inside its agent loop) is one
// start/end pair. There is no token-level logging, so BUSY never flickers.
//
// The standalone CLI keeps `prompting`/`activeTurn` in memory only and writes no
// task state by default, so CLI-only usage has no deterministic BUSY signal and
// is deliberately never treated as busy here (no CPU/process heuristics).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Observable} from './observable.js';

Gio._promisify(Gio.File.prototype, 'query_info_async', 'query_info_finish');
Gio._promisify(Gio.File.prototype, 'read_async', 'read_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');

export const COMMANDCODE_TASK_POLL_SECONDS = 1;
export const COMMANDCODE_TASK_SOURCE = 'desktop-turn';
// A turn that never logs a terminal line (app killed mid-run) is dropped so it
// can never keep the mascot animating indefinitely.
export const COMMANDCODE_TASK_MAX_MS = 45 * 60 * 1000;

const TURN_START = /\[send\] turn running \{"sessionId":"([^"]+)"/;
const TURN_END = /\[send\] turn resolved \{"sessionId":"([^"]+)"/;
const LINE_TIME = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\]/;

export function commandCodeLogPath(configHome = null) {
    const base = configHome ?? GLib.getenv('XDG_CONFIG_HOME') ??
        GLib.build_filenamev([GLib.get_home_dir(), '.config']);
    return GLib.build_filenamev([base, 'Command Code', 'logs', 'main.log']);
}

export class CommandCodeTaskMonitor extends Observable {
    constructor(scheduler, {logPath = null, now = () => Date.now(),
        maxTaskMs = COMMANDCODE_TASK_MAX_MS} = {}) {
        super({busy: false, source: null, startedAt: null});
        this._scheduler = scheduler;
        this._logPath = logPath ?? commandCodeLogPath();
        this._now = now;
        this._maxTaskMs = maxTaskMs;
        this._running = new Map();
        this._offset = 0;
        this._pending = new Uint8Array(0);
        this._inFlight = null;
        this._applicationOpen = false;
        this._destroyed = false;
    }

    start() {
        // One observer, one timer: cancelled in destroy().
        this._scheduler.every('commandcode-task', COMMANDCODE_TASK_POLL_SECONDS,
            () => this.refresh(), true);
    }

    // Command Code cannot be mid-task while its application is closed, so a
    // close clears any tracked turn immediately (also covers a killed app).
    setApplicationOpen(open) {
        const next = Boolean(open);
        if (next === this._applicationOpen) return;
        this._applicationOpen = next;
        if (!next) {
            this._running.clear();
            this._publish();
        }
    }

    refresh() {
        if (this._destroyed) return Promise.resolve();
        if (this._inFlight) return this._inFlight;
        this._inFlight = this._read().finally(() => { this._inFlight = null; });
        return this._inFlight;
    }

    async _read() {
        const file = Gio.File.new_for_path(this._logPath);
        let size;
        try {
            const info = await file.query_info_async('standard::size',
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, null);
            size = info.get_size();
        } catch { return; } // No log yet: the app has never run.
        // Log rotation/truncation: the app restarted, so no turn is in flight.
        if (size < this._offset) {
            this._offset = 0;
            this._pending = new Uint8Array(0);
            this._running.clear();
        }
        if (size === this._offset) { this._expire(); this._publish(); return; }
        const stream = await file.read_async(GLib.PRIORITY_LOW, null);
        let buffer = this._pending;
        try {
            stream.seek(this._offset, GLib.SeekType.SET, null);
            while (!this._destroyed) {
                const bytes = await stream.read_bytes_async(65536, GLib.PRIORITY_LOW, null);
                const chunk = bytes.toArray();
                if (!chunk.length) break;
                this._offset += chunk.length;
                const merged = new Uint8Array(buffer.length + chunk.length);
                merged.set(buffer, 0);
                merged.set(chunk, buffer.length);
                buffer = merged;
            }
        } finally { stream.close(null); }
        // Keep a trailing partial line as bytes so a split UTF-8 sequence
        // survives to the next poll (GJS TextDecoder has no stream option).
        let lastNewline = -1;
        for (let index = buffer.length - 1; index >= 0; index--) {
            if (buffer[index] === 0x0a) { lastNewline = index; break; }
        }
        if (lastNewline < 0) {
            this._pending = buffer.length > 1024 * 1024 ? new Uint8Array(0) : buffer;
        } else {
            const text = new TextDecoder().decode(buffer.subarray(0, lastNewline));
            for (const line of text.split('\n')) this._consume(line);
            this._pending = buffer.subarray(lastNewline + 1);
        }
        this._expire();
        this._publish();
    }

    _consume(line) {
        const start = TURN_START.exec(line);
        if (start) {
            this._running.set(start[1], this._lineTime(line));
            return;
        }
        const end = TURN_END.exec(line);
        if (end) this._running.delete(end[1]);
    }

    _lineTime(line) {
        const match = LINE_TIME.exec(line);
        if (match) {
            const parsed = Date.parse(match[1].replace(' ', 'T'));
            if (Number.isFinite(parsed)) return parsed;
        }
        return this._now();
    }

    _expire() {
        const now = this._now();
        for (const [sessionId, startedAt] of this._running)
            if (now - startedAt > this._maxTaskMs) this._running.delete(sessionId);
    }

    _publish() {
        if (this._destroyed) return;
        let startedAt = null;
        for (const value of this._running.values())
            startedAt = startedAt === null ? value : Math.min(startedAt, value);
        const busy = this._running.size > 0;
        const next = {busy, source: busy ? COMMANDCODE_TASK_SOURCE : null, startedAt};
        const current = this.getState();
        if (current.busy === next.busy && current.source === next.source &&
            current.startedAt === next.startedAt)
            return;
        this._setState(next);
    }

    destroy() {
        this._destroyed = true;
        this._running.clear();
        this._scheduler.cancel('commandcode-task');
        super.destroy();
    }
}

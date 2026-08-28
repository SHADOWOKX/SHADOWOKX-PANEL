import GLib from 'gi://GLib';

export class Scheduler {
    constructor(logger) {
        this._logger = logger;
        this._sources = new Map();
        this._running = new Set();
        this._destroyed = false;
    }

    every(name, seconds, callback, immediate = false) {
        if (this._destroyed)
            return;
        this.cancel(name);
        const interval = Math.max(1, Math.round(seconds));
        const sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._invoke(name, callback);
            return GLib.SOURCE_CONTINUE;
        });
        this._sources.set(name, sourceId);
        if (immediate)
            this._invoke(name, callback);
    }

    _invoke(name, callback) {
        if (this._destroyed || this._running.has(name))
            return;
        this._running.add(name);
        Promise.resolve()
            .then(() => {
                if (!this._destroyed)
                    return callback();
                return null;
            })
            .catch(error => this._logger?.warn(`Scheduled job ${name} failed`, error))
            .finally(() => this._running.delete(name));
    }

    cancel(name) {
        const sourceId = this._sources.get(name);
        if (sourceId)
            GLib.Source.remove(sourceId);
        this._sources.delete(name);
    }

    destroy() {
        this._destroyed = true;
        for (const name of [...this._sources.keys()])
            this.cancel(name);
        this._running.clear();
    }
}

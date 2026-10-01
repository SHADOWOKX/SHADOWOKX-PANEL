import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {Observable} from '../../services/observable.js';
import {JsonStore} from '../../services/jsonStore.js';
import {normalizeUsage, sourceConfig} from './normalize.js';

Gio._promisify(Soup.Session.prototype, 'send_async', 'send_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');
Gio._promisify(Gio.File.prototype, 'query_info_async', 'query_info_finish');
Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

function expandPath(path) {
    if (typeof path !== 'string')
        return '';
    return path.startsWith('~/') ? GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]) : path;
}

export class AIProvider extends Observable {
    constructor(id, settings, scheduler) {
        super({status: 'loading', data: null, error: null});
        this.id = id;
        this._settings = settings;
        this._scheduler = scheduler;
        this._session = new Soup.Session({timeout: 15});
        this._destroyed = false;
        this._inFlight = null;
        this._cancellable = new Gio.Cancellable();
        this._generation = 0;
        this._sourceMonitor = null;
        this._sourceRefreshId = 0;
        this._settingsId = settings.connect('changed::ai-sources', () => {
            this._generation++;
            this._cancellable.cancel();
            this._cancellable = new Gio.Cancellable();
            this._setState({status: 'loading', data: null, error: null});
            this._watchSource();
            // Finish cancelling the previous source before reading the replacement.
            Promise.resolve(this._inFlight).finally(() => this.refresh());
        });
    }

    start() {
        this._watchSource();
        this._scheduler.every(`ai-${this.id}`, 60, () => this.refresh());
        return this.refresh();
    }

    _watchSource() {
        this._sourceMonitor?.cancel();
        this._sourceMonitor = null;
        const config = sourceConfig(this._settings, this.id);
        const path = expandPath(config.path) || (this.id === 'deepseek' && config.keyFile
            ? expandPath(config.keyFile) : GLib.build_filenamev([
                GLib.get_user_config_dir(), 'shadow-panel', 'usage', `${this.id}.json`,
            ]));
        if (!GLib.path_is_absolute(path) || this._destroyed) return;
        const file = Gio.File.new_for_path(path);
        let parent = file.get_parent();
        while (parent && !parent.query_exists(null)) parent = parent.get_parent();
        if (!parent) return;
        const target = parent.get_relative_path(file)?.split('/')[0];
        try {
            this._sourceMonitor = parent.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._sourceMonitor.connect('changed', (_monitor, changed, other) => {
                if (this._destroyed || ![changed?.get_basename(), other?.get_basename()].includes(target)) return;
                if (this._sourceRefreshId) GLib.Source.remove(this._sourceRefreshId);
                this._sourceRefreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
                    this._sourceRefreshId = 0;
                    this._watchSource();
                    Promise.resolve(this._inFlight).finally(() => this.refresh());
                    return GLib.SOURCE_REMOVE;
                });
            });
        } catch { /* Minute polling remains available without file monitoring. */ }
    }

    refresh() {
        if (this._destroyed)
            return Promise.resolve();
        if (this._inFlight)
            return this._inFlight;
        const generation = this._generation;
        const cancellable = this._cancellable;
        this._inFlight = this._read(cancellable).then(data => {
            if (!this._destroyed && generation === this._generation)
                this._setState({status: Date.now() - data.updatedAt > 300000 ? 'stale' : 'ready',
                    data, error: null});
        }).catch(error => {
            if (this._destroyed || generation !== this._generation)
                return;
            // Keep the last valid value clearly marked as stale during an outage.
            let data = this.getState().data;
            if (data) {
                data = {...data, windows: data.windows.filter(window =>
                    !window.resetsAt || window.resetsAt > Date.now())};
                if (!data.windows.length && !data.balances.length && data.tokens === null)
                    data = null;
            }
            this._setState({status: data ? 'stale' : 'unavailable', data, error: error.message});
        }).finally(() => { this._inFlight = null; });
        return this._inFlight;
    }

    async _read(cancellable) {
        const config = sourceConfig(this._settings, this.id);
        let raw;
        let reportedAt = Date.now();
        if (this.id === 'deepseek' && config.keyFile && !config.path) {
            raw = await this._deepseek(expandPath(config.keyFile), cancellable);
        } else {
            const path = expandPath(config.path) || GLib.build_filenamev([
                GLib.get_user_config_dir(), 'shadow-panel', 'usage', `${this.id}.json`,
            ]);
            if (!GLib.path_is_absolute(path))
                throw new Error('Choose an absolute usage JSON path in Settings.');
            const file = Gio.File.new_for_path(path);
            const store = new JsonStore(file.get_parent().get_path(), file.get_basename(), null);
            raw = await store.read(null, cancellable);
            if (!raw)
                throw new Error(store.lastReadError
                    ? 'Usage JSON could not be read. Check the file format and permissions.'
                    : 'Connect a usage JSON source in Settings.');
            const info = await file.query_info_async('time::modified',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, cancellable);
            reportedAt = info.get_attribute_uint64('time::modified') * 1000;
        }
        return normalizeUsage({...raw, updatedAt: raw.updatedAt ?? reportedAt}, this.id);
    }

    async _deepseek(path, cancellable) {
        if (!GLib.path_is_absolute(path))
            throw new Error('Choose an absolute API key file path.');
        const file = Gio.File.new_for_path(path);
        const info = await file.query_info_async('standard::size,standard::type,standard::is-symlink',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, cancellable);
        if (info.get_is_symlink() || info.get_file_type() !== Gio.FileType.REGULAR || info.get_size() > 4096)
            throw new Error('API key file must be a regular file smaller than 4 KB.');
        const [bytes] = await file.load_contents_async(cancellable);
        if (bytes.length > 4096)
            throw new Error('API key file is too large.');
        const token = new TextDecoder().decode(bytes).trim();
        if (!token || /\s/.test(token))
            throw new Error('API key file must contain only the API key.');
        const message = Soup.Message.new('GET', 'https://api.deepseek.com/user/balance');
        message.set_flags(Soup.MessageFlags.NO_REDIRECT);
        message.request_headers.replace('Authorization', `Bearer ${token}`);
        let stream;
        try {
            stream = await this._session.send_async(message, GLib.PRIORITY_DEFAULT, cancellable);
            if (message.status_code !== 200)
                throw new Error(`DeepSeek returned HTTP ${message.status_code}. Check your API key or connection.`);
            const chunks = [];
            let size = 0;
            while (true) {
                const chunk = (await stream.read_bytes_async(8192, GLib.PRIORITY_DEFAULT, cancellable)).toArray();
                if (!chunk.length)
                    break;
                size += chunk.length;
                if (size > 1024 * 1024)
                    throw new Error('Usage response is too large.');
                chunks.push(chunk);
            }
            const data = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
                data.set(chunk, offset);
                offset += chunk.length;
            }
            try {
                return JSON.parse(new TextDecoder().decode(data));
            } catch {
                throw new Error('DeepSeek returned an invalid usage response.');
            }
        } finally {
            stream?.close(null);
        }
    }

    destroy() {
        this._destroyed = true;
        this._sourceMonitor?.cancel();
        this._sourceMonitor = null;
        if (this._sourceRefreshId) GLib.Source.remove(this._sourceRefreshId);
        this._sourceRefreshId = 0;
        this._cancellable.cancel();
        this._session.abort();
        this._scheduler.cancel(`ai-${this.id}`);
        this._settings.disconnect(this._settingsId);
        super.destroy();
    }
}

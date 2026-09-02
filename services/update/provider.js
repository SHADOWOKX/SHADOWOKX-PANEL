import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {
    APP_VERSION,
    UPDATE_INDEX_URL,
    UPDATE_REFRESH_INTERVAL_SECONDS,
    UPDATE_STARTUP_DELAY_SECONDS,
    UUID,
} from '../../lib/constants.js';
import {JsonStore} from '../jsonStore.js';
import {Observable} from '../observable.js';
import {
    eligibleChannelReferences,
    selectUpdate,
    validateChannelIndex,
    validateUpdateManifest,
} from './manifest.js';

Gio._promisify(Soup.Session.prototype, 'send_async', 'send_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');
Gio._promisify(Gio.InputStream.prototype, 'close_async', 'close_finish');
Gio._promisify(Gio.File.prototype, 'replace_async', 'replace_finish');
Gio._promisify(Gio.File.prototype, 'copy_async', 'copy_finish');
Gio._promisify(Gio.File.prototype, 'delete_async', 'delete_finish');
Gio._promisify(Gio.OutputStream.prototype, 'write_bytes_async', 'write_bytes_finish');

const MAX_JSON_BYTES = 512 * 1024;
const MAX_LINUX_PACKAGE_BYTES = 32 * 1024 * 1024;
const GNOME_SHELL_MAJOR = 50;
const STARTUP_JOB = 'update-startup-check';
const BACKGROUND_JOB = 'update-background-check';

function initialState() {
    return {
        status: 'idle',
        currentVersion: APP_VERSION,
        available: null,
        progress: null,
        error: null,
        lastChecked: null,
        important: false,
    };
}

export class UpdateProvider extends Observable {
    constructor(extensionPath, settings, scheduler, logger, options = {}) {
        super(initialState());
        this._extensionPath = extensionPath;
        this._settings = settings;
        this._scheduler = scheduler;
        this._logger = logger;
        this._indexUrl = options.indexUrl ?? UPDATE_INDEX_URL;
        this._session = options.session ?? new Soup.Session({
            timeout: 20,
            user_agent: `Shadowokx Panel/${APP_VERSION} updater`,
        });
        this._cache = new JsonStore(
            GLib.build_filenamev([GLib.get_user_cache_dir(), 'shadow-panel']),
            'updates.json',
            logger,
            MAX_JSON_BYTES
        );
        this._result = new JsonStore(
            GLib.build_filenamev([GLib.get_user_cache_dir(), 'shadow-panel']),
            'update-result.json',
            logger,
            16 * 1024
        );
        this._checkPromise = null;
        this._installPromise = null;
        this._cancellable = null;
        this._settingsIds = [];
        this._cached = {index: null, indexEtag: null, manifests: {}};
        this._cacheFingerprint = '';
        this._destroyed = false;
    }

    async start() {
        const result = await this._result.read(null);
        if (result?.status === 'installed' || result?.status === 'failed') {
            this._setState({
                ...initialState(),
                status: result.status,
                error: result.status === 'failed'
                    ? 'The previous update failed and the installed version was restored.'
                    : null,
                installedVersion: typeof result.version === 'string' ? result.version : null,
                signOutRecommended: Boolean(result.sign_out_recommended),
            });
            try {
                await Gio.File.new_for_path(this._result.path).delete_async(
                    GLib.PRIORITY_DEFAULT,
                    null
                );
            } catch (error) {
                if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                    this._logger?.warn('Could not clear update result marker', error);
            }
        }
        const cached = await this._cache.read(null);
        if (cached && typeof cached === 'object') {
            this._cached = {
                index: cached.index ?? null,
                indexEtag: typeof cached.indexEtag === 'string' ? cached.indexEtag : null,
                manifests: cached.manifests && typeof cached.manifests === 'object'
                    ? cached.manifests : {},
            };
            this._cacheFingerprint = JSON.stringify(this._cached);
        }
        if (this._destroyed)
            return this.getState();
        this._settingsIds.push(
            this._settings.connect('changed::automatic-update-checks', () => this._reschedule()),
            this._settings.connect('changed::update-channel', () => {
                if (this._settings.get_boolean('automatic-update-checks'))
                    this.check(true);
            })
        );
        this._reschedule();
        return this.getState();
    }

    _reschedule() {
        this._scheduler.cancel(STARTUP_JOB);
        this._scheduler.cancel(BACKGROUND_JOB);
        if (!this._settings.get_boolean('automatic-update-checks') || this._destroyed)
            return;
        this._scheduler.once(
            STARTUP_JOB,
            UPDATE_STARTUP_DELAY_SECONDS,
            () => this.check(false)
        );
        this._scheduler.every(
            BACKGROUND_JOB,
            UPDATE_REFRESH_INTERVAL_SECONDS,
            () => this.check(false)
        );
    }

    check(manual = true) {
        if (this._destroyed)
            return Promise.resolve(this.getState());
        if (this._checkPromise)
            return this._checkPromise;
        this._checkPromise = this._check(manual)
            .catch(error => {
                if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    this._logger?.warn('Update check failed', error);
                    this._setState({
                        ...this.getState(),
                        status: 'error',
                        error: 'Updates could not be checked. Shadowokx Panel will retry later.',
                        progress: null,
                    });
                }
                return this.getState();
            })
            .finally(() => {
                this._checkPromise = null;
                this._cancellable = null;
            });
        return this._checkPromise;
    }

    async _check(manual) {
        const previous = this.getState();
        this._setState({...previous, status: 'checking', error: null, progress: null});
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        const indexResponse = await this._fetchJson(
            this._indexUrl,
            this._cached.indexEtag,
            this._cached.index,
            cancellable
        );
        const index = validateChannelIndex(indexResponse.value);
        this._cached.index = indexResponse.raw;
        this._cached.indexEtag = indexResponse.etag;
        const selectedChannel = this._settings.get_string('update-channel') === 'beta'
            ? 'beta' : 'stable';
        const manifests = new Map();
        for (const reference of eligibleChannelReferences(index, selectedChannel)) {
            const cachedManifest = this._cached.manifests[reference.manifestUrl] ?? {};
            const response = await this._fetchJson(
                reference.manifestUrl,
                cachedManifest.etag ?? null,
                cachedManifest.value ?? null,
                cancellable
            );
            const manifest = validateUpdateManifest(response.value);
            manifests.set(manifest.version, manifest);
            this._cached.manifests[reference.manifestUrl] = {
                etag: response.etag,
                value: response.raw,
            };
        }
        await this._writeCacheIfChanged();
        const selection = selectUpdate({
            index,
            manifests,
            currentVersion: APP_VERSION,
            selectedChannel,
            updaterVersion: APP_VERSION,
            platform: 'linux',
            compatibility: platform =>
                platform.uuid === UUID &&
                GNOME_SHELL_MAJOR >= platform.gnomeShellMinimum &&
                GNOME_SHELL_MAJOR <= platform.gnomeShellMaximum,
        });
        const now = Date.now();
        if (!selection) {
            this._setState({
                ...initialState(),
                status: 'up-to-date',
                lastChecked: now,
            });
            return this.getState();
        }
        this._setState({
            ...initialState(),
            status: 'available',
            available: selection.manifest,
            lastChecked: now,
            important: selection.important,
        });
        if (manual)
            this._logger?.debug('Update available', {version: selection.manifest.version});
        return this.getState();
    }

    installAvailable() {
        if (this._destroyed)
            return Promise.resolve(false);
        if (this._installPromise)
            return this._installPromise;
        const manifest = this.getState().available;
        if (!manifest)
            return Promise.resolve(false);
        this._installPromise = this._downloadAndLaunch(manifest)
            .catch(error => {
                if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    this._logger?.warn('Update installation failed', error);
                    this._setState({
                        ...this.getState(),
                        status: 'error',
                        error: 'The update was not installed. Your current version is unchanged.',
                        progress: null,
                    });
                }
                return false;
            })
            .finally(() => {
                this._installPromise = null;
                this._cancellable = null;
            });
        return this._installPromise;
    }

    async _downloadAndLaunch(manifest) {
        const asset = manifest.platforms.linux;
        if (asset.size > MAX_LINUX_PACKAGE_BYTES)
            throw new Error('Linux update package exceeds the client safety limit');
        this._setState({...this.getState(), status: 'downloading', progress: 0, error: null});
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        const updateDirectory = GLib.build_filenamev([
            GLib.get_user_cache_dir(),
            'shadow-panel',
            'updates',
        ]);
        if (GLib.mkdir_with_parents(updateDirectory, 0o700) !== 0)
            throw new Error('Update staging directory could not be created');
        const archivePath = GLib.build_filenamev([
            updateDirectory,
            `${manifest.version}-${asset.asset}`,
        ]);
        await this._download(asset, archivePath, cancellable);
        this._setState({...this.getState(), status: 'verifying', progress: 1});
        const helperSource = Gio.File.new_for_path(GLib.build_filenamev([
            this._extensionPath,
            'update-helper.py',
        ]));
        const helperPath = GLib.build_filenamev([updateDirectory, 'update-helper.py']);
        await helperSource.copy_async(
            Gio.File.new_for_path(helperPath),
            Gio.FileCopyFlags.OVERWRITE,
            GLib.PRIORITY_DEFAULT,
            cancellable,
            null
        );
        if (GLib.chmod(helperPath, 0o700) !== 0)
            throw new Error('Update helper permissions could not be secured');
        const resultPath = GLib.build_filenamev([
            GLib.get_user_cache_dir(),
            'shadow-panel',
            'update-result.json',
        ]);
        Gio.Subprocess.new([
            '/usr/bin/python3',
            helperPath,
            archivePath,
            asset.sha256,
            UUID,
            manifest.version,
            resultPath,
        ], Gio.SubprocessFlags.NONE);
        this._setState({...this.getState(), status: 'installing', progress: 1});
        return true;
    }

    async _download(asset, destinationPath, cancellable) {
        const message = Soup.Message.new('GET', asset.url);
        const stream = await this._session.send_async(
            message,
            GLib.PRIORITY_DEFAULT,
            cancellable
        );
        const file = Gio.File.new_for_path(destinationPath);
        let output = null;
        try {
            if (message.get_status() < 200 || message.get_status() >= 300)
                throw new Error(`Update download returned HTTP ${message.get_status()}`);
            const contentLength = message.get_response_headers().get_content_length();
            if (contentLength > MAX_LINUX_PACKAGE_BYTES ||
                contentLength > 0 && contentLength !== asset.size)
                throw new Error('Update download size does not match the manifest');
            output = await file.replace_async(
                null,
                false,
                Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION,
                GLib.PRIORITY_DEFAULT,
                cancellable
            );
            const checksum = new GLib.Checksum(GLib.ChecksumType.SHA256);
            let total = 0;
            let lastProgress = -1;
            while (true) {
                const bytes = await stream.read_bytes_async(
                    64 * 1024,
                    GLib.PRIORITY_DEFAULT,
                    cancellable
                );
                const data = bytes.get_data();
                if (!data?.length)
                    break;
                total += data.length;
                if (total > asset.size || total > MAX_LINUX_PACKAGE_BYTES)
                    throw new Error('Update download exceeded the manifest size');
                checksum.update(data);
                await output.write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, cancellable);
                const progress = Math.min(99, Math.floor(total / asset.size * 100));
                if (progress >= lastProgress + 5) {
                    lastProgress = progress;
                    this._setState({...this.getState(), progress: progress / 100});
                }
            }
            if (total !== asset.size || checksum.get_string().toLowerCase() !== asset.sha256)
                throw new Error('Update checksum verification failed');
            await output.close_async(GLib.PRIORITY_DEFAULT, cancellable);
            output = null;
        } catch (error) {
            try {
                file.delete(null);
            } catch {
                // The failed download may not have created a destination yet.
            }
            throw error;
        } finally {
            try {
                await output?.close_async(GLib.PRIORITY_DEFAULT, null);
            } catch {
                // Cancellation may have already closed the stream.
            }
            try {
                await stream.close_async(GLib.PRIORITY_DEFAULT, null);
            } catch {
                // Soup can close a cancelled response itself.
            }
        }
    }

    async _fetchJson(url, etag, cachedValue, cancellable) {
        const message = Soup.Message.new('GET', url);
        if (etag)
            message.get_request_headers().append('If-None-Match', etag);
        const stream = await this._session.send_async(
            message,
            GLib.PRIORITY_DEFAULT,
            cancellable
        );
        try {
            if (message.get_status() === Soup.Status.NOT_MODIFIED && cachedValue)
                return {value: cachedValue, raw: cachedValue, etag};
            if (message.get_status() < 200 || message.get_status() >= 300)
                throw new Error(`Update metadata returned HTTP ${message.get_status()}`);
            const contentLength = message.get_response_headers().get_content_length();
            if (contentLength > MAX_JSON_BYTES)
                throw new Error('Update metadata is too large');
            const chunks = [];
            let total = 0;
            while (true) {
                const bytes = await stream.read_bytes_async(
                    32 * 1024,
                    GLib.PRIORITY_DEFAULT,
                    cancellable
                );
                const data = bytes.get_data();
                if (!data?.length)
                    break;
                total += data.length;
                if (total > MAX_JSON_BYTES)
                    throw new Error('Update metadata is too large');
                chunks.push(data);
            }
            const contents = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) {
                contents.set(chunk, offset);
                offset += chunk.length;
            }
            const raw = JSON.parse(new TextDecoder().decode(contents));
            return {
                value: raw,
                raw,
                etag: message.get_response_headers().get_one('ETag') ?? null,
            };
        } finally {
            try {
                await stream.close_async(GLib.PRIORITY_DEFAULT, null);
            } catch {
                // The request may already be cancelled or closed by Soup.
            }
        }
    }

    async _writeCacheIfChanged() {
        const fingerprint = JSON.stringify(this._cached);
        if (fingerprint === this._cacheFingerprint)
            return;
        await this._cache.write(this._cached);
        this._cacheFingerprint = fingerprint;
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        this._cancellable?.cancel();
        this._session.abort();
        this._scheduler.cancel(STARTUP_JOB);
        this._scheduler.cancel(BACKGROUND_JOB);
        super.destroy();
    }
}

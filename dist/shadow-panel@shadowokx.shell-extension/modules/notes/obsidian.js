import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Observable} from '../../services/observable.js';
import {launchUri} from '../../services/launcher.js';

Gio._promisify(Gio.File.prototype, 'query_info_async', 'query_info_finish');
Gio._promisify(Gio.File.prototype, 'make_directory_async', 'make_directory_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'delete_async', 'delete_finish');

function settingsError(message) {
    const error = new Error(message);
    error.code = message;
    return error;
}

export function normalizeTargetFolder(value) {
    const folder = typeof value === 'string' ? value.trim() : '';
    if (!folder)
        return '';
    if (GLib.path_is_absolute(folder) || folder.includes('\\') ||
        /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(folder))
        throw settingsError('target-unsafe');
    const segments = folder.split('/');
    if (segments.some(segment => !segment || segment === '.' || segment === '..'))
        throw settingsError('target-unsafe');
    return segments.join('/');
}

export function renderObsidianFilename(pattern, now = new Date()) {
    const rawPattern = typeof pattern === 'string' ? pattern.trim() : '';
    if (!rawPattern || rawPattern.length > 120 || rawPattern.includes('/') ||
        rawPattern.includes('\\') ||
        /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(rawPattern)) {
        throw settingsError('pattern-invalid');
    }
    const pad = value => String(value).padStart(2, '0');
    const date = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    const time = pad(now.getHours()) + '-' + pad(now.getMinutes()) + '-' + pad(now.getSeconds());
    const timestamp = date + '-' + time;
    const rendered = rawPattern
        .replaceAll('{date}', date)
        .replaceAll('{time}', time)
        .replaceAll('{timestamp}', timestamp)
        .replace(/[/:*?"<>|\u0000-\u001f\u007f]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/^\.+/, '')
        .trim();
    const candidate = rendered || 'Shadow Note ' + timestamp;
    let safeBase = '';
    let byteLength = 0;
    const encoder = new TextEncoder();
    for (const character of candidate) {
        const characterBytes = encoder.encode(character).length;
        if (byteLength + characterBytes > 180)
            break;
        safeBase += character;
        byteLength += characterBytes;
    }
    return (safeBase || 'Shadow Note ' + timestamp) + '.md';
}

export function validateObsidianSettings(vaultPath, targetFolder, filenamePattern) {
    const path = typeof vaultPath === 'string' ? vaultPath.trim() : '';
    if (!path)
        throw settingsError('vault-unconfigured');
    if (!GLib.path_is_absolute(path))
        throw settingsError('vault-not-absolute');
    if (/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(path))
        throw settingsError('target-unsafe');
    const canonicalVaultPath = GLib.canonicalize_filename(path, null);
    const normalizedTargetFolder = normalizeTargetFolder(targetFolder);
    renderObsidianFilename(filenamePattern);
    const segments = normalizedTargetFolder ? normalizedTargetFolder.split('/') : [];
    const targetPath = GLib.build_filenamev([canonicalVaultPath, ...segments]);
    if (targetPath !== canonicalVaultPath &&
        !targetPath.startsWith(canonicalVaultPath + GLib.DIR_SEPARATOR_S)) {
        throw settingsError('target-unsafe');
    }
    return {
        vaultPath: canonicalVaultPath,
        vaultName: GLib.path_get_basename(canonicalVaultPath),
        targetFolder: normalizedTargetFolder,
        targetPath,
        filenamePattern: filenamePattern.trim(),
    };
}

function moveAsync(source, destination, cancellable) {
    return new Promise((resolve, reject) => {
        source.move_async(
            destination,
            Gio.FileCopyFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            cancellable,
            null,
            (file, result) => {
                try {
                    resolve(file.move_finish(result));
                } catch (error) {
                    reject(error);
                }
            }
        );
    });
}

export class ObsidianService extends Observable {
    constructor(settings, logger) {
        super({
            status: 'unconfigured',
            configured: false,
            vaultName: null,
            targetFolder: null,
            error: null,
            lastSavedAt: null,
            lastSavedFile: null,
        });
        this._settings = settings;
        this._logger = logger;
        this._settingsIds = [];
        this._cancellables = new Set();
        this._generation = 0;
        this._saveSequence = 0;
        this._configGeneration = 0;
        this._refreshId = 0;
        this._resolved = null;
        this._destroyed = false;
    }

    async start() {
        for (const key of [
            'obsidian-vault-path',
            'obsidian-target-folder',
            'obsidian-filename-pattern',
        ]) {
            this._settingsIds.push(this._settings.connect('changed::' + key, () => {
                this._configGeneration++;
                this._queueRefresh();
            }));
        }
        return this.refresh();
    }

    _queueRefresh() {
        if (this._refreshId)
            GLib.Source.remove(this._refreshId);
        this._refreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
            this._refreshId = 0;
            if (!this._destroyed)
                this.refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    async refresh() {
        const generation = ++this._generation;
        const vaultPath = this._settings.get_string('obsidian-vault-path').trim();
        if (!vaultPath) {
            this._resolved = null;
            const state = {
                ...this.getState(),
                status: 'unconfigured',
                configured: false,
                vaultName: null,
                targetFolder: null,
                error: null,
            };
            this._setState(state);
            return state;
        }
        this._setState({...this.getState(), status: 'checking', configured: true, error: null});
        const cancellable = this._newCancellable();
        try {
            const resolved = await this._resolveConfig(false, cancellable);
            if (this._destroyed || generation !== this._generation)
                return this.getState();
            this._resolved = resolved;
            const state = {
                ...this.getState(),
                status: 'ready',
                configured: true,
                vaultName: resolved.vaultName,
                targetFolder: resolved.targetFolder || 'Vault root',
                error: null,
            };
            this._setState(state);
            return state;
        } catch (error) {
            if (this._destroyed || generation !== this._generation)
                return this.getState();
            this._resolved = null;
            const state = {
                ...this.getState(),
                status: error.code === 'vault-unconfigured' ? 'unconfigured' : 'error',
                configured: true,
                error: this._friendlyError(error),
            };
            this._setState(state);
            return state;
        } finally {
            this._cancellables.delete(cancellable);
        }
    }

    async save(text) {
        if (this._destroyed)
            throw settingsError('service-destroyed');
        const saveSequence = ++this._saveSequence;
        const configGeneration = this._configGeneration;
        const cleanText = typeof text === 'string'
            ? [...text.trim()].slice(0, 2000).join('')
            : '';
        if (!cleanText)
            throw settingsError('note-empty');
        const cancellable = this._newCancellable();
        let temporary = null;
        try {
            const resolved = await this._resolveConfig(true, cancellable);
            const folder = Gio.File.new_for_path(resolved.targetPath);
            const baseName = renderObsidianFilename(resolved.filenamePattern).slice(0, -3);
            temporary = folder.get_child('.' + baseName + '.' + GLib.uuid_string_random() + '.tmp');
            await temporary.replace_contents_async(
                new TextEncoder().encode(cleanText + '\n'),
                null,
                false,
                Gio.FileCreateFlags.PRIVATE,
                cancellable
            );
            let destination = null;
            for (let suffix = 1; suffix <= 100; suffix++) {
                const fileName = baseName + (suffix === 1 ? '' : ' ' + suffix) + '.md';
                const candidate = folder.get_child(fileName);
                try {
                    await moveAsync(temporary, candidate, cancellable);
                    destination = candidate;
                    break;
                } catch (error) {
                    if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                        throw error;
                }
            }
            if (!destination)
                throw settingsError('filename-exhausted');
            temporary = null;
            if (!this._destroyed && saveSequence === this._saveSequence &&
                configGeneration === this._configGeneration) {
                this._resolved = resolved;
                const state = {
                    ...this.getState(),
                    status: 'ready',
                    configured: true,
                    vaultName: resolved.vaultName,
                    targetFolder: resolved.targetFolder || 'Vault root',
                    error: null,
                    lastSavedAt: Date.now(),
                    lastSavedFile: destination.get_basename(),
                };
                this._setState(state);
            }
            return {
                path: destination.get_path(),
                fileName: destination.get_basename(),
                vaultName: resolved.vaultName,
                targetFolder: resolved.targetFolder,
            };
        } catch (error) {
            this._logger?.debug('obsidian.save.failed', {code: error.code ?? 'io-error'});
            if (!this._destroyed && saveSequence === this._saveSequence &&
                configGeneration === this._configGeneration) {
                this._setState({
                    ...this.getState(),
                    status: 'error',
                    error: this._friendlyError(error),
                });
            }
            throw error;
        } finally {
            if (temporary) {
                try {
                    await temporary.delete_async(GLib.PRIORITY_DEFAULT, null);
                } catch {
                    // The temporary file may not exist if creation failed.
                }
            }
            this._cancellables.delete(cancellable);
        }
    }

    async openVaultFolder() {
        if (this._destroyed)
            throw settingsError('service-destroyed');
        const cancellable = this._newCancellable();
        try {
            const resolved = await this._resolveConfig(true, cancellable);
            return launchUri(Gio.File.new_for_path(resolved.targetPath).get_uri(), this._logger);
        } finally {
            this._cancellables.delete(cancellable);
        }
    }

    async openObsidian() {
        if (this._destroyed)
            throw settingsError('service-destroyed');
        const resolved = validateObsidianSettings(
            this._settings.get_string('obsidian-vault-path'),
            this._settings.get_string('obsidian-target-folder'),
            this._settings.get_string('obsidian-filename-pattern')
        );
        return launchUri('obsidian://open?path=' + encodeURIComponent(resolved.vaultPath), this._logger);
    }

    _newCancellable() {
        if (this._destroyed)
            throw settingsError('service-destroyed');
        const cancellable = new Gio.Cancellable();
        this._cancellables.add(cancellable);
        return cancellable;
    }

    async _resolveConfig(createTarget, cancellable) {
        const resolved = validateObsidianSettings(
            this._settings.get_string('obsidian-vault-path'),
            this._settings.get_string('obsidian-target-folder'),
            this._settings.get_string('obsidian-filename-pattern')
        );
        let directory = await this._requireDirectoryTree(
            resolved.vaultPath,
            'vault-not-found',
            cancellable
        );
        await this._requireDirectory(directory.get_child('.obsidian'), 'vault-not-obsidian', cancellable);
        for (const segment of resolved.targetFolder ? resolved.targetFolder.split('/') : []) {
            directory = directory.get_child(segment);
            try {
                await this._requireDirectory(directory, 'target-not-directory', cancellable);
            } catch (error) {
                if (error.code !== 'target-not-directory-missing')
                    throw error;
                if (!createTarget)
                    break;
                try {
                    await directory.make_directory_async(GLib.PRIORITY_DEFAULT, cancellable);
                } catch (createError) {
                    if (!createError.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                        throw createError;
                    await this._requireDirectory(directory, 'target-not-directory', cancellable);
                }
            }
        }
        return resolved;
    }

    async _requireDirectoryTree(path, missingCode, cancellable) {
        let directory = Gio.File.new_for_path(GLib.DIR_SEPARATOR_S);
        for (const segment of path.split(GLib.DIR_SEPARATOR_S).filter(Boolean)) {
            directory = directory.get_child(segment);
            await this._requireDirectory(directory, missingCode, cancellable);
        }
        return directory;
    }

    async _requireDirectory(file, missingCode, cancellable) {
        try {
            const info = await file.query_info_async(
                'standard::type,standard::is-symlink',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                GLib.PRIORITY_DEFAULT,
                cancellable
            );
            if (info.get_is_symlink() || info.get_file_type() === Gio.FileType.SYMBOLIC_LINK)
                throw settingsError('path-symlink');
            if (info.get_file_type() !== Gio.FileType.DIRECTORY)
                throw settingsError(missingCode);
        } catch (error) {
            if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                throw settingsError(missingCode === 'target-not-directory'
                    ? 'target-not-directory-missing'
                    : missingCode);
            }
            throw error;
        }
    }

    _friendlyError(error) {
        const messages = {
            'vault-unconfigured': 'Choose an Obsidian vault in Preferences.',
            'vault-not-absolute': 'The vault path must be absolute.',
            'vault-not-found': 'The selected vault folder does not exist.',
            'vault-not-obsidian': 'The selected folder is not an Obsidian vault.',
            'target-unsafe': 'The target folder must stay inside the selected vault.',
            'target-not-directory': 'The target path contains a non-folder item.',
            'path-symlink': 'Symlinked vault paths are not used for safety.',
            'pattern-invalid': 'The filename pattern contains an unsupported path character.',
            'filename-exhausted': 'A unique Obsidian note filename could not be created.',
            'note-empty': 'Enter a note before saving.',
            'service-destroyed': 'The Obsidian integration is no longer active.',
        };
        return messages[error.code] ?? 'The note could not be saved to Obsidian.';
    }

    destroy() {
        this._destroyed = true;
        this._generation++;
        if (this._refreshId)
            GLib.Source.remove(this._refreshId);
        this._refreshId = 0;
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        for (const cancellable of this._cancellables)
            cancellable.cancel();
        this._cancellables.clear();
        super.destroy();
    }
}

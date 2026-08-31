import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'query_info_async', 'query_info_finish');
Gio._promisify(
    Gio.File.prototype,
    'make_directory_async',
    'make_directory_finish'
);

// Serialize reads and writes by absolute path across store instances. This
// matters during a rapid extension reload: a replacement store must not read
// stale data while the previous instance is finishing an atomic write.
const FILE_QUEUES = new Map();

export class JsonStore {
    constructor(baseDirectory, fileName, logger, maximumBytes = 1024 * 1024) {
        this._directory = Gio.File.new_for_path(baseDirectory);
        this._file = this._directory.get_child(fileName);
        this._logger = logger;
        this._maximumBytes = maximumBytes;
        this._lastReadError = null;
    }

    get path() {
        return this._file.get_path();
    }

    get lastReadError() {
        return this._lastReadError;
    }

    async read(fallback, cancellable = null) {
        this._lastReadError = null;
        try {
            await (FILE_QUEUES.get(this.path) ?? Promise.resolve());
            await this._validateDirectory(cancellable);
            const info = await this._file.query_info_async(
                'standard::size,standard::type,standard::is-symlink',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                GLib.PRIORITY_DEFAULT,
                cancellable
            );
            if (info.get_is_symlink() || info.get_file_type() === Gio.FileType.SYMBOLIC_LINK)
                throw new Error(`${this._file.get_basename()} must not be a symbolic link`);
            if (info.get_size() > this._maximumBytes)
                throw new Error(`${this._file.get_basename()} exceeds the safe size limit`);
            const [contents] = await this._file.load_contents_async(cancellable);
            if (contents.length > this._maximumBytes)
                throw new Error(`${this._file.get_basename()} exceeds the safe size limit`);
            return JSON.parse(new TextDecoder().decode(contents));
        } catch (error) {
            if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                return fallback;
            this._lastReadError = error;
            this._logger?.warn(`Could not read ${this._file.get_basename()}`, error);
            return fallback;
        }
    }

    write(value, cancellable = null) {
        const previous = FILE_QUEUES.get(this.path) ?? Promise.resolve();
        const operation = previous.then(() => this._write(value, cancellable));
        const settled = operation.catch(() => {});
        FILE_QUEUES.set(this.path, settled);
        settled.finally(() => {
            if (FILE_QUEUES.get(this.path) === settled)
                FILE_QUEUES.delete(this.path);
        });
        return operation;
    }

    async _write(value, cancellable) {
        const contents = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
        if (contents.length > this._maximumBytes)
            throw new Error(`${this._file.get_basename()} exceeds the safe size limit`);
        await this._ensureDirectory(cancellable);
        await this._file.replace_contents_async(
            contents,
            null,
            false,
            Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION,
            cancellable
        );
    }

    async _ensureDirectory(cancellable) {
        await this._ensureDirectoryAt(this._directory, cancellable);
        await this._validateDirectory(cancellable);
        const path = this._directory.get_path();
        if (!path || GLib.chmod(path, 0o700) !== 0)
            throw new Error(`${this._directory.get_basename()} permissions could not be secured`);
    }

    async _validateDirectory(cancellable) {
        const info = await this._directory.query_info_async(
            'standard::type,standard::is-symlink',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            GLib.PRIORITY_DEFAULT,
            cancellable
        );
        if (info.get_is_symlink() || info.get_file_type() !== Gio.FileType.DIRECTORY)
            throw new Error(`${this._directory.get_basename()} must be a real directory`);
    }

    async _ensureDirectoryAt(directory, cancellable) {
        const parent = directory.get_parent();
        if (parent)
            await this._ensureDirectoryAt(parent, cancellable);
        try {
            await directory.make_directory_async(
                GLib.PRIORITY_DEFAULT,
                cancellable
            );
        } catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                throw error;
        }
    }
}

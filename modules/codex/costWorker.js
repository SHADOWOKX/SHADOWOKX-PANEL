import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {sessionCostParser, summarizeCosts} from './cost.js';

const root = GLib.getenv('CODEX_HOME') || GLib.build_filenamev([GLib.get_home_dir(), '.codex']);
const cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'shadow-panel']);
const cachePath = GLib.build_filenamev([cacheDir, 'cost-sessions-v2.json']);
let cache = {};
try {
    cache = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(cachePath)[1]));
} catch { /* First scan. */ }
const next = {};
let changed = false;
let failedFiles = 0;
let foundRoot = false;
function scan(path, depth = 0) {
    if (depth > 5)
        return;
    const dir = Gio.File.new_for_path(path);
    let enumerator;
    try {
        enumerator = dir.enumerate_children('standard::name,standard::type,standard::size,time::modified,time::modified-usec',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        foundRoot = true;
    } catch (error) {
        if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            failedFiles++;
        return;
    }
    try {
        let info;
        while ((info = enumerator.next_file(null))) {
            const file = dir.get_child(info.get_name());
            if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                scan(file.get_path(), depth + 1);
            } else if (info.get_file_type() === Gio.FileType.REGULAR && info.get_name().endsWith('.jsonl')) {
                const key = file.get_path();
                const stamp = `${info.get_size()}:${info.get_attribute_uint64('time::modified')}:${info.get_attribute_uint32('time::modified-usec')}`;
                if (cache[key]?.stamp === stamp) {
                    next[key] = cache[key];
                    continue;
                }
                changed = true;
                let stream;
                try {
                    stream = new Gio.DataInputStream({base_stream: file.read(null)});
                    const parser = sessionCostParser();
                    let line;
                    while ((line = stream.read_line_utf8(null)[0]) !== null) {
                        // Ignore partial writes and unrelated conversation records.
                        if (!line.includes('"token_count"') && !line.includes('"turn_context"') &&
                            !line.includes('"session_meta"'))
                            continue;
                        try { parser.accept(JSON.parse(line)); } catch { /* Incomplete JSONL. */ }
                    }
                    next[key] = {stamp, records: parser.records};
                } catch { failedFiles++; }
                finally { stream?.close(null); }
            }
        }
    } finally { enumerator.close(null); }
}
scan(GLib.build_filenamev([root, 'sessions']));
scan(GLib.build_filenamev([root, 'archived_sessions']));
const result = summarizeCosts(Object.values(next).flatMap(item => item.records));
result.failedFiles = failedFiles;
result.partial ||= failedFiles > 0;
result.available = foundRoot && result.records > 0;
try {
    if (changed || Object.keys(cache).length !== Object.keys(next).length) {
    GLib.mkdir_with_parents(cacheDir, 0o700);
    Gio.File.new_for_path(cachePath).replace_contents(new TextEncoder().encode(JSON.stringify(next)),
        null, false, Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    }
} catch { /* A read-only cache must not prevent a live estimate. */ }
print(JSON.stringify(result));

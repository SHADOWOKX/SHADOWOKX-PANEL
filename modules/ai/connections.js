import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {AI_IDS} from '../../lib/constants.js';
import {JsonStore} from '../../services/jsonStore.js';
import {normalizeUsage, sourceConfig} from './normalize.js';

export function updateSource(settings, id, patch) {
    if (!AI_IDS.includes(id)) throw new Error('Unknown provider');
    let sources;
    try { sources = JSON.parse(settings.get_string('ai-sources')); } catch { sources = {}; }
    if (!sources || typeof sources !== 'object' || Array.isArray(sources)) sources = {};
    sources[id] = {...sourceConfig(settings, id), ...patch};
    settings.set_string('ai-sources', JSON.stringify(sources));
}

function showProvider(settings, id) {
    const added = settings.get_strv('ai-providers');
    if (!added.includes(id)) settings.set_strv('ai-providers', [...added, id]);
    settings.set_strv('hidden-ai-providers', settings.get_strv('hidden-ai-providers').filter(value => value !== id));
}

export async function connectUsageFile(settings, id, path) {
    if (!path || !GLib.path_is_absolute(path)) throw new Error('Choose a local usage JSON file.');
    const file = Gio.File.new_for_path(path);
    const store = new JsonStore(file.get_parent().get_path(), file.get_basename(), null);
    const raw = await store.read(null);
    if (!raw) throw new Error('The selected file could not be read as JSON.');
    const usage = normalizeUsage(raw, id);
    updateSource(settings, id, {path});
    showProvider(settings, id);
    return usage;
}

export async function saveDeepseekKey(settings, token, directory = null) {
    token = token.trim();
    if (!token || token.length > 4096 || /\s/.test(token)) throw new Error('Paste a valid API key.');
    const base = directory ?? GLib.build_filenamev([GLib.get_user_config_dir(), 'shadow-panel', 'keys']);
    GLib.mkdir_with_parents(base, 0o700);
    const info = Gio.File.new_for_path(base).query_info('standard::type,standard::is-symlink',
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    if (info.get_is_symlink() || info.get_file_type() !== Gio.FileType.DIRECTORY)
        throw new Error('Key directory must be a real directory.');
    const file = Gio.File.new_for_path(GLib.build_filenamev([base, 'deepseek.key']));
    await file.replace_contents_async(new TextEncoder().encode(token + '\n'), null, false,
        Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    updateSource(settings, 'deepseek', {path: '', keyFile: file.get_path()});
    showProvider(settings, 'deepseek');
}

export async function connectClaude(settings, extensionPath, directory = null) {
    const base = directory ?? (GLib.getenv('CLAUDE_CONFIG_DIR') || GLib.build_filenamev([GLib.get_home_dir(), '.claude']));
    const store = new JsonStore(base, 'settings.json', null);
    const config = await store.read({});
    if (store.lastReadError || !config || typeof config !== 'object' || Array.isArray(config))
        throw new Error('Claude settings could not be read.');
    const script = GLib.build_filenamev([extensionPath, 'modules', 'ai', 'claude-statusline.py']);
    let command = `python3 ${GLib.shell_quote(script)}`;
    const previous = config.statusLine?.command;
    if (typeof previous === 'string' && previous && !previous.includes('claude-statusline.py'))
        command += ` --previous-command ${GLib.shell_quote(previous)}`;
    else if (typeof previous === 'string' && previous.includes('--previous-command'))
        command = previous;
    // The first backup preserves custom commands and every unrelated setting.
    const backup = new JsonStore(base, 'settings.shadow-panel-backup.json', null);
    const existingBackup = await backup.read(null);
    if (!existingBackup && previous) await backup.write(config);
    await store.write({...config, statusLine: {...config.statusLine, type: 'command', command}});
    updateSource(settings, 'claude', {path: ''});
    showProvider(settings, 'claude');
}

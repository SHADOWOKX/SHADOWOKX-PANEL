import GLib from 'gi://GLib';

function readProductVersion() {
    const [modulePath] = GLib.filename_from_uri(import.meta.url);
    const versionPath = GLib.build_filenamev([
        GLib.path_get_dirname(modulePath),
        '..',
        'VERSION',
    ]);
    const [loaded, contents] = GLib.file_get_contents(versionPath);
    if (!loaded)
        throw new Error('Shadowokx Panel VERSION could not be read');
    const version = new TextDecoder().decode(contents).trim();
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version))
        throw new Error('Shadowokx Panel VERSION is invalid');
    return version;
}

export const UUID = 'shadow-panel@shadowokx';
export const APP_VERSION = readProductVersion();
export const UPDATER_PROTOCOL_VERSION = '1.0.0';
export const MODULE_IDS = Object.freeze(['codex', 'weather']);
export const VISIBLE_CODEX_REFRESH_INTERVAL = 30;
export const BACKGROUND_CODEX_REFRESH_INTERVAL = 60;
export const CODEX_TIMED_LABEL_INTERVAL = 10;
export const UPDATE_INDEX_URL =
    'https://raw.githubusercontent.com/SHADOWOKX/SHADOWOKX-PANEL/release-metadata/channels.json';
export const UPDATE_STARTUP_DELAY_SECONDS = 15;
export const UPDATE_REFRESH_INTERVAL_SECONDS = 12 * 60 * 60;

export const ACCENTS = Object.freeze({
    purple: '#8b5cf6',
    blue: '#3b82f6',
    cyan: '#06b6d4',
    emerald: '#10b981',
    orange: '#f97316',
    amber: '#f59e0b',
    rose: '#f43f5e',
    graphite: '#64748b',
});

export const MODULE_META = Object.freeze({
    codex: {name: 'ChatGPT Codex', icon: 'system-run-symbolic'},
    weather: {name: 'Weather', icon: 'weather-clear-symbolic'},
});

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const ALLOWED_SCHEMES = new Set(['codex']);

export function launchUri(uri, logger = null) {
    const scheme = GLib.uri_parse_scheme(uri);
    if (!ALLOWED_SCHEMES.has(scheme))
        return Promise.reject(new Error('Unsupported URI scheme'));
    return new Promise((resolve, reject) => {
        Gio.AppInfo.launch_default_for_uri_async(uri, null, null, (_source, result) => {
            try {
                Gio.AppInfo.launch_default_for_uri_finish(result);
                resolve(true);
            } catch (error) {
                logger?.warn('Could not open external application', error);
                reject(error);
            }
        });
    });
}

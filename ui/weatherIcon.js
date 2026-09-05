import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const icons = new Map();

export function weatherArtwork(condition) {
    const name = condition?.icon ?? '';
    if (name.includes('few-clouds'))
        return condition?.isDay === false ? 'partly-cloudy-night' : 'partly-cloudy';
    if (name.includes('clear'))
        return condition?.isDay === false ? 'clear-night' : 'clear';
    if (name.includes('overcast')) return 'cloudy';
    if (name.includes('fog')) return 'fog';
    if (name.includes('snow')) return 'snow';
    if (name.includes('storm')) return 'storm';
    if (name.includes('showers-scattered')) return 'drizzle';
    if (name.includes('showers')) return 'rain';
    return 'unknown';
}

export function weatherGIcon(extensionPath, condition) {
    const path = GLib.build_filenamev([extensionPath, 'icons', 'weather',
        `${weatherArtwork(condition)}.svg`]);
    if (!icons.has(path))
        icons.set(path, Gio.FileIcon.new(Gio.File.new_for_path(path)));
    return icons.get(path);
}

export function temperatureGIcon(extensionPath) {
    const path = GLib.build_filenamev([extensionPath, 'icons', 'weather', 'temperature-symbolic.svg']);
    if (!icons.has(path))
        icons.set(path, Gio.FileIcon.new(Gio.File.new_for_path(path)));
    return icons.get(path);
}

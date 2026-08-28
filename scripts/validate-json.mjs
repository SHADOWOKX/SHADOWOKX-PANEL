import GLib from 'gi://GLib';
import System from 'system';

for (const path of ARGV) {
    try {
        const [loaded, contents] = GLib.file_get_contents(path);
        if (!loaded)
            throw new Error('could not be read');
        JSON.parse(new TextDecoder().decode(contents));
    } catch (error) {
        printerr(`${path}: invalid JSON (${error.message})`);
        System.exit(1);
    }
}

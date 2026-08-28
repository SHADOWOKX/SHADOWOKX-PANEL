import GLib from 'gi://GLib';
import System from 'system';

import {renderSummary} from './shareImage.js';

function fail(message) {
    printerr(message);
    System.exit(1);
}

if (ARGV.length !== 1)
    fail('Invalid summary image worker arguments');

try {
    const [loaded, contents] = GLib.file_get_contents('/dev/stdin');
    if (!loaded || contents.length > 64 * 1024)
        fail('Invalid summary image payload');
    const payload = JSON.parse(new TextDecoder().decode(contents));
    renderSummary(ARGV[0], payload.state, payload.options);
} catch {
    fail('Summary image rendering failed');
}

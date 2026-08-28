import GLib from 'gi://GLib';
import System from 'system';

import {APP_VERSION, UUID} from '../lib/constants.js';

const projectDirectory = ARGV[0];
if (!projectDirectory) {
    printerr('Project directory is required');
    System.exit(1);
}

function readJson(name) {
    const path = GLib.build_filenamev([projectDirectory, name]);
    const [loaded, contents] = GLib.file_get_contents(path);
    if (!loaded)
        throw new Error(`${name} could not be read`);
    return JSON.parse(new TextDecoder().decode(contents));
}

function readText(name) {
    const path = GLib.build_filenamev([projectDirectory, name]);
    const [loaded, contents] = GLib.file_get_contents(path);
    if (!loaded)
        throw new Error(`${name} could not be read`);
    return new TextDecoder().decode(contents);
}

try {
    const metadata = readJson('metadata.json');
    const packageMetadata = readJson('package.json');
    if (metadata.uuid !== UUID || metadata['settings-schema'] !==
        'org.gnome.shell.extensions.shadow-panel') {
        throw new Error('extension identity is inconsistent');
    }
    if (!Array.isArray(metadata['shell-version']) ||
        metadata['shell-version'].length !== 1 || metadata['shell-version'][0] !== '50') {
        throw new Error('only GNOME Shell 50 must be declared');
    }
    if (!Number.isInteger(metadata.version) || metadata.version < 1)
        throw new Error('extension revision is invalid');
    if (packageMetadata.version !== APP_VERSION)
        throw new Error('semantic version declarations are inconsistent');
    if (!readText('README.md').includes(`Release \`${APP_VERSION}\``))
        throw new Error('README release version is inconsistent');
    const modules = GLib.build_filenamev([projectDirectory, 'modules']);
    for (const removed of ['notes', 'tasks', 'todo', 'tools']) {
        if (GLib.file_test(GLib.build_filenamev([modules, removed]), GLib.FileTest.EXISTS))
            throw new Error(`removed module directory still exists: ${removed}`);
    }
    if (!GLib.file_test(
        GLib.build_filenamev([projectDirectory, 'icons', 'chatgpt.png']),
        GLib.FileTest.IS_REGULAR
    )) {
        throw new Error('the bundled ChatGPT icon is missing');
    }
} catch (error) {
    printerr(`Release validation failed: ${error.message}`);
    System.exit(1);
}

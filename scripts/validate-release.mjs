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
    for (const required of ['README.md', 'LICENSE', 'NOTICE.md', '.gitignore']) {
        if (!GLib.file_test(
            GLib.build_filenamev([projectDirectory, required]),
            GLib.FileTest.IS_REGULAR
        )) {
            throw new Error(`required release file is missing: ${required}`);
        }
    }
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
    const ignore = readText('.gitignore');
    for (const generated of [
        'dist/',
        'schemas/gschemas.compiled',
        'codex.json',
        'codex-history.json',
        'weather.json',
    ]) {
        if (!ignore.includes(generated))
            throw new Error(`generated release output is not ignored: ${generated}`);
    }
    const modules = GLib.build_filenamev([projectDirectory, 'modules']);
    for (const removed of ['notes', 'tasks', 'todo', 'tools']) {
        if (GLib.file_test(GLib.build_filenamev([modules, removed]), GLib.FileTest.EXISTS))
            throw new Error(`removed module directory still exists: ${removed}`);
    }
    for (const mascot of [
        'robot-sleep.svg',
        'robot-sleep-breathe.svg',
        'robot-sleep-twitch.svg',
        'robot-awake.svg',
        'robot-wake-antenna.svg',
        'robot-wake-half.svg',
        'robot-sleepy.svg',
        'robot-sleep-relax.svg',
        'robot-blink.svg',
        'robot-active-01.svg',
        'robot-active-02.svg',
        'robot-active-03.svg',
        'robot-active-04.svg',
        'robot-active-05.svg',
        'robot-active-06.svg',
        'robot-active-07.svg',
        'robot-active-08.svg',
        'robot-active-09.svg',
        'robot-active-10.svg',
        'robot-active-11.svg',
        'robot-active-12.svg',
        'robot-active-13.svg',
    ]) {
        if (!GLib.file_test(
            GLib.build_filenamev([projectDirectory, 'icons', 'mascot', mascot]),
            GLib.FileTest.IS_REGULAR
        )) {
            throw new Error(`the bundled mascot frame is missing: ${mascot}`);
        }
    }
    if (GLib.file_test(
        GLib.build_filenamev([projectDirectory, 'icons', 'chatgpt.png']),
        GLib.FileTest.EXISTS
    )) {
        throw new Error('the retired third-party ChatGPT icon is still bundled');
    }
} catch (error) {
    printerr(`Release validation failed: ${error.message}`);
    System.exit(1);
}

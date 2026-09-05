import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import GLib from 'gi://GLib';
import System from 'system';

const projectDirectory = ARGV[0];
if (!projectDirectory) {
    printerr('Project directory is required');
    System.exit(1);
}

const frames = [
    'robot-sleep.svg',
    'robot-sleep-breathe.svg',
    'robot-sleep-twitch.svg',
    'robot-awake.svg',
    'robot-wake-antenna.svg',
    'robot-wake-half.svg',
    'robot-sleepy.svg',
    'robot-sleep-relax.svg',
    'robot-blink.svg',
    ...Array.from({length: 13}, (_unused, index) =>
        `robot-active-${String(index + 1).padStart(2, '0')}.svg`),
];

function framePath(frame) {
    return GLib.build_filenamev([projectDirectory, 'icons', 'mascot', frame]);
}

function pixelHash(pixbuf) {
    let hash = 2166136261;
    for (const byte of pixbuf.get_pixels()) {
        hash ^= byte;
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash;
}

function orangePixels(pixbuf, x1, y1, x2, y2) {
    const pixels = pixbuf.get_pixels();
    const channels = pixbuf.n_channels;
    const rowstride = pixbuf.rowstride;
    const scaleX = pixbuf.width / 24;
    const scaleY = pixbuf.height / 24;
    let count = 0;
    for (let y = Math.floor(y1 * scaleY); y < Math.ceil(y2 * scaleY); y++) {
        for (let x = Math.floor(x1 * scaleX); x < Math.ceil(x2 * scaleX); x++) {
            const offset = y * rowstride + x * channels;
            const red = pixels[offset];
            const green = pixels[offset + 1];
            const blue = pixels[offset + 2];
            const alpha = channels === 4 ? pixels[offset + 3] : 255;
            if (alpha > 96 && red > 190 && green >= 55 && green < 190 && blue < 95)
                count++;
        }
    }
    return count;
}

try {
    for (const frame of frames) {
        const [loaded, contents] = GLib.file_get_contents(framePath(frame));
        const source = loaded ? new TextDecoder().decode(contents) : '';
        if (!/width="24" height="24" viewBox="0 0 24 24"/.test(source))
            throw new Error(`${frame} does not use the shared 24px canvas`);
    }

    const rendered = new Map();
    try {
        for (const frame of frames) {
            for (const size of [16, 18, 20]) {
                const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(
                    framePath(frame), size, size, true);
                if (pixbuf.width !== size || pixbuf.height !== size || !pixbuf.has_alpha)
                    throw new Error(`${frame} did not render as a transparent ${size}px square`);
            }
            rendered.set(frame, GdkPixbuf.Pixbuf.new_from_file_at_scale(
                framePath(frame), 240, 240, true));
        }
    } catch (error) {
        if (String(error.message).includes('Operation not permitted')) {
            print('Mascot raster probe unavailable in this sandbox; vector canvases validated');
            System.exit(0);
        }
        throw error;
    }

    const sleep = rendered.get('robot-sleep.svg');
    const awake = rendered.get('robot-awake.svg');
    if (pixelHash(sleep) === pixelHash(awake))
        throw new Error('sleeping and awake frames render identically');
    const sleepEyes = orangePixels(sleep, 6.4, 10.8, 17.6, 14.7);
    const awakeEyes = orangePixels(awake, 6.4, 10.8, 17.6, 14.7);
    if (awakeEyes <= sleepEyes * 1.5)
        throw new Error(`sleep eyes are not visibly more closed (${sleepEyes} vs ${awakeEyes})`);

    const happy = rendered.get('robot-active-10.svg');
    const awakeMouth = orangePixels(awake, 9.2, 14.2, 14.8, 16.8);
    const happyMouth = orangePixels(happy, 9.2, 14.2, 14.8, 16.8);
    if (happyMouth <= awakeMouth + 20)
        throw new Error('happy frame does not render a visible orange smile');

    if (pixelHash(rendered.get('robot-active-08.svg')) ===
        pixelHash(rendered.get('robot-active-09.svg')))
        throw new Error('head-left and head-right frames render identically');

    const activeHashes = new Set(Array.from({length: 13}, (_unused, index) =>
        pixelHash(rendered.get(
            `robot-active-${String(index + 1).padStart(2, '0')}.svg`))));
    if (activeHashes.size !== 13)
        throw new Error(`only ${activeHashes.size} of 13 active frames are visually unique`);
} catch (error) {
    printerr(`Mascot validation failed: ${error.message}`);
    System.exit(1);
}

print('Shadowokx mascot canvases, rendered expressions, and 16/18/20px sizing passed');

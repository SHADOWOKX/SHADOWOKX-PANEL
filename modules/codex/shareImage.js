import Cairo from 'cairo';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

import {formatClock, formatCountdown, formatResetDate} from '../../lib/format.js';

Gio._promisify(Gio.File.prototype, 'make_directory_async', 'make_directory_finish');
Gio._promisify(Gio.File.prototype, 'delete_async', 'delete_finish');
Gio._promisify(Gio.File.prototype, 'create_async', 'create_finish');
Gio._promisify(Gio.OutputStream.prototype, 'close_async', 'close_finish');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

const WIDTH = 1200;
const HEIGHT = 675;

const PALETTES = Object.freeze({
    defaultDark: {
        canvas: '#1c1d1f', card: '#27282b', panel: '#303135', text: '#f6f6f4',
        muted: '#aaadb3', track: '#45474d', border: '#3b3d42',
    },
    defaultLight: {
        canvas: '#e7e8e8', card: '#fafafa', panel: '#f1f1ef', text: '#222326',
        muted: '#6e7279', track: '#dedfdf', border: '#d6d7d7',
    },
    'claude-gray': {
        canvas: '#252623', card: '#30312f', panel: '#393a37', text: '#f5f3ed',
        muted: '#b6b4ac', track: '#4d4e49', border: '#464742',
    },
    graphite: {
        canvas: '#15171a', card: '#1f2226', panel: '#292d32', text: '#f5f6f7',
        muted: '#a5abb3', track: '#3a3f46', border: '#343941',
    },
    'light-neutral': {
        canvas: '#e4e5e3', card: '#f5f5f2', panel: '#eaeae6', text: '#242523',
        muted: '#696d68', track: '#d5d6d1', border: '#d1d2cd',
    },
});

function parseHex(color) {
    return [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16) / 255);
}

function normalizeShareWindow(value) {
    if (!value || !Number.isFinite(value.remainingPercent) || !Number.isFinite(value.usedPercent))
        return null;
    return {
        remainingPercent: Math.max(0, Math.min(100, Math.round(value.remainingPercent))),
        usedPercent: Math.max(0, Math.min(100, Math.round(value.usedPercent))),
        resetsAt: Number.isFinite(value.resetsAt) ? value.resetsAt : null,
    };
}

function setColor(context, color) {
    context.setSourceRGB(...parseHex(color));
}

function roundedRectangle(context, x, y, width, height, radius) {
    const right = x + width;
    const bottom = y + height;
    context.newSubPath();
    context.arc(right - radius, y + radius, radius, -Math.PI / 2, 0);
    context.arc(right - radius, bottom - radius, radius, 0, Math.PI / 2);
    context.arc(x + radius, bottom - radius, radius, Math.PI / 2, Math.PI);
    context.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5);
    context.closePath();
}

function fillRounded(context, x, y, width, height, radius, color) {
    roundedRectangle(context, x, y, width, height, radius);
    setColor(context, color);
    context.fill();
}

function drawText(context, text, x, y, width, size, color, weight = 'Normal', alignment = 'left') {
    const layout = PangoCairo.create_layout(context);
    layout.set_text(String(text), -1);
    layout.set_width(Math.round(width * Pango.SCALE));
    layout.set_ellipsize(Pango.EllipsizeMode.END);
    layout.set_single_paragraph_mode(true);
    layout.set_alignment(alignment === 'right' ? Pango.Alignment.RIGHT :
        alignment === 'center' ? Pango.Alignment.CENTER : Pango.Alignment.LEFT);
    layout.set_font_description(Pango.FontDescription.from_string(`Sans ${weight} ${size}`));
    setColor(context, color);
    context.moveTo(x, y);
    PangoCairo.show_layout(context, layout);
}

function drawMascot(context, x, y, size) {
    context.save();
    context.translate(x, y);
    context.scale(size / 24, size / 24);

    context.setLineCap(Cairo.LineCap.ROUND);
    context.setLineWidth(1.35);
    setColor(context, '#b7bcc3');
    context.moveTo(12, 6.4);
    context.lineTo(12, 3.5);
    context.stroke();
    context.arc(12, 2.65, 1.35, 0, Math.PI * 2);
    setColor(context, '#ff8a00');
    context.fill();

    fillRounded(context, 0.65, 10, 3, 6.7, 1.4, '#3c4048');
    fillRounded(context, 20.35, 10, 3, 6.7, 1.4, '#3c4048');
    fillRounded(context, 2.2, 6.2, 19.6, 13.4, 5.4, '#b7bcc3');
    fillRounded(context, 4, 8.15, 16, 9.35, 3.8, '#0e1117');
    for (const eyeX of [8.55, 15.45]) {
        context.arc(eyeX, 12.85, 1.45, 0, Math.PI * 2);
        setColor(context, '#ff8a00');
        context.fill();
    }
    context.moveTo(8.5, 19.25);
    context.lineTo(15.5, 19.25);
    context.lineTo(14.85, 21.25);
    context.lineTo(9.15, 21.25);
    context.closePath();
    setColor(context, '#3c4048');
    context.fill();
    context.restore();
}

export function resolveSharePalette(backgroundTheme, interfaceTheme) {
    if (PALETTES[backgroundTheme])
        return PALETTES[backgroundTheme];
    return interfaceTheme === 'light' ? PALETTES.defaultLight : PALETTES.defaultDark;
}

export function renderSummary(path, state, options) {
    const palette = resolveSharePalette(
        options.backgroundTheme,
        options.interfaceTheme
    );
    const accent = /^#[0-9a-fA-F]{6}$/.test(options.accent ?? '') ? options.accent : '#8b5cf6';
    const weekly = normalizeShareWindow(state.weekly);
    const fiveHour = normalizeShareWindow(state.fiveHour);
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, WIDTH, HEIGHT);
    const context = new Cairo.Context(surface);

    setColor(context, palette.canvas);
    context.paint();
    fillRounded(context, 55, 45, 1090, 585, 34, palette.card);

    drawMascot(context, 92, 72, 62);
    drawText(context, 'Shadowokx Panel', 176, 72, 560, 25, palette.text, 'Bold');
    drawText(context, 'ChatGPT / Codex', 177, 110, 500, 14, palette.muted, 'Normal');

    drawText(context, 'WEEKLY LIMIT', 100, 181, 500, 13, palette.muted, 'Bold');
    if (weekly) {
        drawText(context, `${weekly.remainingPercent}%`, 96, 207, 430, 74, accent, 'Bold');
        drawText(context, 'remaining', 399, 258, 220, 18, palette.muted, 'Normal');
        fillRounded(context, 100, 320, 1000, 15, 8, palette.track);
        if (weekly.remainingPercent > 0) {
            fillRounded(context, 100, 320, 1000 * weekly.remainingPercent / 100,
                15, Math.min(8, 5 * weekly.remainingPercent), accent);
        }
        drawText(context, formatCountdown(weekly.resetsAt, options.nowMs),
            100, 358, 500, 18, palette.text, 'Bold');
        drawText(context, `${weekly.usedPercent}% used`, 820, 359, 280, 16, palette.muted, 'Normal', 'right');
        drawText(context, formatResetDate(weekly.resetsAt),
            100, 392, 720, 14, palette.muted, 'Normal');
    } else {
        drawText(context, 'Unavailable', 96, 219, 640, 50, palette.text, 'Bold');
        drawText(context, 'This Codex session did not report a weekly window.',
            100, 302, 850, 17, palette.muted, 'Normal');
    }

    fillRounded(context, 100, 452, 1000, 102, 18, palette.panel);
    drawText(context, '5-HOUR WINDOW', 126, 477, 300, 12, palette.muted, 'Bold');
    if (fiveHour) {
        drawText(context, `${fiveHour.remainingPercent}% remaining`,
            126, 507, 350, 23, palette.text, 'Bold');
        drawText(context, formatCountdown(fiveHour.resetsAt, options.nowMs),
            700, 511, 365, 15, palette.muted, 'Normal', 'right');
    } else {
        drawText(context, 'Unavailable · Not reported by this session',
            126, 507, 700, 18, palette.muted, 'Normal');
    }

    const cached = state.status === 'stale' || state.status === 'cached' ? ' · Cached' : '';
    drawText(context, `Updated ${formatClock(state.lastSuccessfulRefresh)}${cached}`,
        100, 584, 1000, 14, palette.muted, 'Normal');

    surface.writeToPNG(path);
    surface.finish();
    if (GLib.chmod(path, 0o600) !== 0)
        throw new Error('Could not secure the summary image');
}

async function renderInWorker(path, state, options, cancellable) {
    const gjs = GLib.find_program_in_path('gjs');
    const worker = Gio.File.new_for_uri(import.meta.url)
        .get_parent()
        .get_child('shareWorker.js')
        .get_path();
    if (!gjs || !worker)
        throw new Error('The summary image worker is unavailable');
    const process = Gio.Subprocess.new(
        [gjs, '-m', worker, path],
        Gio.SubprocessFlags.STDIN_PIPE |
            Gio.SubprocessFlags.STDOUT_SILENCE |
            Gio.SubprocessFlags.STDERR_SILENCE
    );
    let timedOut = false;
    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
        timedOut = true;
        try {
            process.force_exit();
        } catch {
            // The worker may have completed at the timeout boundary.
        }
        return GLib.SOURCE_REMOVE;
    });
    const payload = JSON.stringify({state, options});
    try {
        await process.communicate_utf8_async(payload, cancellable);
        if (timedOut)
            throw new Error('Summary image rendering timed out');
        if (!process.get_successful())
            throw new Error('Summary image rendering failed');
    } catch (error) {
        try {
            process.force_exit();
        } catch {
            // The worker is already stopped.
        }
        throw error;
    } finally {
        if (!timedOut)
            GLib.Source.remove(timeoutId);
    }
}

async function ensureDirectory(directory, cancellable) {
    const parent = directory.get_parent();
    if (parent)
        await ensureDirectory(parent, cancellable);
    try {
        await directory.make_directory_async(GLib.PRIORITY_DEFAULT, cancellable);
    } catch (error) {
        if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            throw error;
    }
}

function moveAsync(source, destination, cancellable) {
    return new Promise((resolve, reject) => {
        source.move_async(
            destination,
            Gio.FileCopyFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            cancellable,
            null,
            (file, result) => {
                try {
                    resolve(file.move_finish(result));
                } catch (error) {
                    reject(error);
                }
            }
        );
    });
}

function timestamp(nowMs) {
    const now = new Date(nowMs);
    const pad = value => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-` +
        `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export async function exportCodexSummaryImage(state, options = {}) {
    const weekly = normalizeShareWindow(state?.weekly);
    const fiveHour = normalizeShareWindow(state?.fiveHour);
    if (!weekly && !fiveHour)
        throw new Error('No Codex usage is available to export');
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const pictures = options.outputDirectory ??
        GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) ??
        GLib.build_filenamev([GLib.get_home_dir(), 'Pictures']);
    const directory = Gio.File.new_for_path(
        options.outputDirectory ? pictures : GLib.build_filenamev([pictures, 'Shadowokx'])
    );
    const cancellable = options.cancellable ?? null;
    await ensureDirectory(directory, cancellable);

    const stem = `Shadow-Codex-${timestamp(nowMs)}`;
    let temporary = directory.get_child(`.${stem}-${GLib.uuid_string_random()}.tmp`);
    try {
        const stream = await temporary.create_async(
            Gio.FileCreateFlags.PRIVATE,
            GLib.PRIORITY_DEFAULT,
            cancellable
        );
        await stream.close_async(GLib.PRIORITY_DEFAULT, cancellable);
        const workerState = {
            status: state.status,
            weekly,
            fiveHour,
            lastSuccessfulRefresh: state.lastSuccessfulRefresh,
        };
        const workerOptions = {
            nowMs,
            accent: options.accent,
            backgroundTheme: options.backgroundTheme,
            interfaceTheme: options.interfaceTheme,
        };
        await renderInWorker(
            temporary.get_path(),
            workerState,
            workerOptions,
            cancellable
        );
        for (let suffix = 1; suffix <= 100; suffix++) {
            const name = stem + (suffix === 1 ? '' : `-${suffix}`) + '.png';
            const destination = directory.get_child(name);
            try {
                await moveAsync(temporary, destination, cancellable);
                temporary = null;
                return {
                    path: destination.get_path(),
                    fileName: name,
                    directoryPath: directory.get_path(),
                };
            } catch (error) {
                if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                    throw error;
            }
        }
        throw new Error('Could not choose a unique image filename');
    } finally {
        if (temporary) {
            try {
                await temporary.delete_async(GLib.PRIORITY_DEFAULT, null);
            } catch {
                // The temporary file may not exist after an encoding failure.
            }
        }
    }
}

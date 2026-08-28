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

function drawKnot(context, centerX, centerY, radius, color) {
    context.save();
    context.translate(centerX, centerY);
    setColor(context, color);
    context.setLineWidth(Math.max(3, radius * 0.12));
    context.setLineCap(Cairo.LineCap.ROUND);
    context.setLineJoin(Cairo.LineJoin.ROUND);
    for (let index = 0; index < 6; index++) {
        context.save();
        context.rotate(index * Math.PI / 3);
        context.moveTo(-radius * 0.24, -radius * 0.42);
        context.curveTo(
            -radius * 0.92, -radius * 0.68,
            -radius * 0.72, -radius,
            0, -radius
        );
        context.curveTo(
            radius * 0.72, -radius,
            radius * 0.92, -radius * 0.68,
            radius * 0.24, -radius * 0.42
        );
        context.stroke();
        context.restore();
    }
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

    drawKnot(context, 108, 103, 27, accent);
    drawText(context, 'Codex usage', 150, 71, 500, 28, palette.text, 'Bold');
    const identity = [state.accountName, state.planLabel].filter(Boolean).join(' · ') || 'Shadowokx Panel';
    drawText(context, identity, 151, 110, 600, 14, palette.muted, 'Normal');
    drawText(context, 'SHADOWOKX PANEL', 805, 80, 280, 12, palette.muted, 'Bold', 'right');

    drawText(context, 'WEEKLY CAPACITY', 100, 174, 500, 13, palette.muted, 'Bold');
    if (weekly) {
        drawText(context, `${weekly.remainingPercent}%`, 96, 202, 430, 72, palette.text, 'Bold');
        drawText(context, 'remaining', 388, 251, 220, 18, palette.muted, 'Normal');
        fillRounded(context, 100, 316, 1000, 16, 8, palette.track);
        if (weekly.remainingPercent > 0) {
            fillRounded(context, 100, 316, 1000 * weekly.remainingPercent / 100,
                16, Math.min(8, 5 * weekly.remainingPercent), accent);
        }
        drawText(context, formatCountdown(weekly.resetsAt, options.nowMs),
            100, 351, 500, 18, palette.text, 'Bold');
        drawText(context, `${weekly.usedPercent}% used`, 820, 352, 280, 16, palette.muted, 'Normal', 'right');
        drawText(context, `Reset ${formatResetDate(weekly.resetsAt)}`,
            100, 384, 720, 14, palette.muted, 'Normal');
    } else {
        drawText(context, 'Unavailable', 96, 219, 640, 50, palette.text, 'Bold');
        drawText(context, 'The current Codex session did not report a weekly window.',
            100, 302, 850, 17, palette.muted, 'Normal');
    }

    fillRounded(context, 100, 435, 500, 112, 20, palette.panel);
    drawText(context, '5-HOUR WINDOW', 126, 459, 300, 12, palette.muted, 'Bold');
    if (fiveHour) {
        drawText(context, `${fiveHour.remainingPercent}% left`, 126, 489, 250, 24, palette.text, 'Bold');
        drawText(context, formatCountdown(fiveHour.resetsAt, options.nowMs),
            340, 493, 225, 14, palette.muted, 'Normal', 'right');
    } else {
        drawText(context, 'Not reported', 126, 489, 300, 22, palette.text, 'Bold');
    }

    fillRounded(context, 620, 435, 480, 112, 20, palette.panel);
    drawText(context, 'SESSION', 646, 459, 200, 12, palette.muted, 'Bold');
    const credits = state.resetCreditsAvailable > 0
        ? `${state.resetCreditsAvailable} reset credit${state.resetCreditsAvailable === 1 ? '' : 's'}`
        : 'Connected';
    drawText(context, credits, 646, 488, 420, 17, palette.text, 'Bold');
    if (state.clientVersion) {
        drawText(context, `Codex ${state.clientVersion}`,
            646, 518, 420, 13, palette.muted, 'Normal');
    }

    const status = state.status === 'stale' || state.status === 'cached' ? 'Cached' :
        state.status === 'refreshing' ? 'Updating' : 'Connected';
    drawText(context, `${status} · Updated ${formatClock(state.lastSuccessfulRefresh)}`,
        100, 577, 1000, 14, palette.muted, 'Normal');

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
        options.outputDirectory ? pictures : GLib.build_filenamev([pictures, 'Shadowokx Panel'])
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
            accountName: state.accountName,
            planLabel: state.planLabel,
            weekly,
            fiveHour,
            resetCreditsAvailable: state.resetCreditsAvailable,
            clientVersion: state.clientVersion,
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

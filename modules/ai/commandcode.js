import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');
Gio._promisify(Gio.Subprocess.prototype, 'wait_async', 'wait_finish');

export const COMMANDCODE_INTERVAL = 180;
export const COMMANDCODE_LIMITATION = 'For native live usage, add your Command Code API key in Settings. CLI login and the panel Secret Service connection are separate.';

// Only retain a boolean. Never forward stdout, stderr, remote errors or credential fields.
export function parseCommandCodeStatus(output) {
    try {
        const raw = JSON.parse(output);
        if (typeof raw?.authenticated !== 'boolean') return 'unsupported';
        if (raw.error) return 'error';
        return raw.authenticated ? 'authenticated' : 'signed-out';
    } catch { return 'unsupported'; }
}

export async function commandCodeStatus(cancellable = null, executable = null, timeoutSeconds = 15) {
    // Do not use command-code: on Linux that name can be the Electron desktop app.
    const binary = executable ?? GLib.find_program_in_path('cmdc') ?? GLib.find_program_in_path('commandcode') ?? GLib.find_program_in_path('cmd');
    if (!binary) return 'missing';
    let process;
    let timer = 0;
    let cancelled = 0;
    let timedOut = false;
    try {
        process = Gio.Subprocess.new([binary, 'status', '--json'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE | Gio.SubprocessFlags.STDIN_PIPE);
        process.get_stdin_pipe().close(null);
        if (cancellable?.is_cancelled()) { process.force_exit(); return 'error'; }
        cancelled = cancellable?.connect(() => process.force_exit()) ?? 0;
        timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeoutSeconds, () => {
            timer = 0;
            timedOut = true;
            process.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        const stream = process.get_stdout_pipe();
        const chunks = [];
        let length = 0;
        while (true) {
            const bytes = (await stream.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, cancellable)).toArray();
            if (!bytes.length) break;
            length += bytes.length;
            if (length > 16384) return 'unsupported';
            chunks.push(bytes);
        }
        const output = new Uint8Array(length);
        let offset = 0;
        for (const bytes of chunks) { output.set(bytes, offset); offset += bytes.length; }
        return timedOut || cancellable?.is_cancelled() ? 'error' : parseCommandCodeStatus(new TextDecoder().decode(output));
    } catch { return 'error'; }
    finally {
        if (timer) GLib.Source.remove(timer);
        if (cancelled) cancellable.disconnect(cancelled);
        process?.force_exit();
        if (process) {
            try { await process.wait_async(null); } catch { /* No subprocess details leave this boundary. */ }
        }
    }
}

export function commandCodeMessage(status) {
    const prefix = ({authenticated: 'Command Code login detected. ',
        'signed-out': 'Sign in with cmdc login (Windows) or cmd login (Linux). ',
        missing: 'Install the Command Code CLI and sign in with cmd login. ',
        unsupported: 'Update the Command Code CLI to support status --json. ',
        error: 'Could not verify Command Code login. Retry or sign in again. '})[status] ?? '';
    return prefix + COMMANDCODE_LIMITATION;
}

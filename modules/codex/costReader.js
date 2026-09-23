import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

export class CostReader {
    async read() {
        const file = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('costWorker.js');
        const command = ['gjs', '-m', file.get_path()];
        const ionice = GLib.find_program_in_path('ionice');
        const nice = GLib.find_program_in_path('nice');
        if (ionice)
            command.unshift(ionice, '-c', '3');
        if (nice)
            command.unshift(nice, '-n', '10');
        this._process = Gio.Subprocess.new(command,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        const process = this._process;
        let timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 45, () => {
            timeout = 0;
            process.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        try {
            const [stdout] = await process.communicate_utf8_async(null, null);
            if (!process.get_successful())
                throw new Error('cost-scan-failed');
            const result = JSON.parse(stdout);
            if (!result || !Number.isFinite(result.cost))
                throw new Error('cost-scan-invalid');
            return result;
        } finally {
            if (timeout)
                GLib.Source.remove(timeout);
            this._process = null;
        }
    }

    destroy() {
        this._process?.force_exit();
    }
}

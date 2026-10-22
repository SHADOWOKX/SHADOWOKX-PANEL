import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import {connectCommandCode, disconnectCommandCode} from './connections.js';
import {lookupCommandCodeKey} from './commandcodeCredentials.js';
import {CommandCodeApi} from './commandcodeApi.js';
import {CommandCodeError} from '../../lib/commandcodeUsage.js';

// Shared by extension Settings and the development connection window.
export function commandCodeSetupRows(settings, window, toast, connected = null) {
    const cancellation = new Gio.Cancellable();
    const api = new CommandCodeApi();
    let closed = false;
    const key = new Adw.PasswordEntryRow({title: 'Command Code API key', show_apply_button: true});
    const status = new Adw.ActionRow({title: 'Live Command Code usage',
        subtitle: 'Read-only account requests every 3 minutes. Credentials stay in GNOME Secret Service.'});
    const check = new Gtk.Button({label: 'Check connection', valign: Gtk.Align.CENTER});
    const remove = new Gtk.Button({label: 'Forget key', valign: Gtk.Align.CENTER});
    const safeError = error => error instanceof CommandCodeError ? error.message : 'Command Code connection could not be saved. Retry.';
    const busy = value => { key.sensitive = !value; check.sensitive = !value; remove.sensitive = !value; };
    const show = usage => {
        status.subtitle = `${usage.plan ?? 'Plan unavailable'} · Account usage received. Key stored in GNOME Secret Service.`;
        connected?.(usage);
    };
    key.connect('apply', async () => {
        let token = key.text.trim();
        key.text = '';
        busy(true);
        status.subtitle = 'Verifying account usage…';
        try {
            const usage = await connectCommandCode(settings, token, cancellation);
            if (!closed) { show(usage); toast('Command Code connected securely.'); }
        } catch (error) { if (!closed) { status.subtitle = safeError(error); toast(status.subtitle); } }
        finally { token = null; if (!closed) busy(false); }
    });
    check.connect('clicked', async () => {
        busy(true);
        try {
            let token = await lookupCommandCodeKey(cancellation);
            if (!token) throw new CommandCodeError('authentication-required');
            const usage = await api.fetch(token, cancellation);
            token = null;
            if (!closed) show(usage);
        } catch (error) { if (!closed) status.subtitle = safeError(error); }
        finally { if (!closed) busy(false); }
    });
    remove.connect('clicked', async () => {
        busy(true);
        try {
            await disconnectCommandCode(settings, cancellation);
            if (!closed) { status.subtitle = 'API key removed from GNOME Secret Service.'; toast('Command Code key forgotten.'); }
        } catch (error) { if (!closed) status.subtitle = safeError(error); }
        finally { if (!closed) busy(false); }
    });
    status.add_suffix(check);
    status.add_suffix(remove);
    window.connect('close-request', () => { closed = true; key.text = ''; cancellation.cancel(); api.destroy(); return false; });
    return [status, key, new Adw.ActionRow({title: 'Usage data source',
        subtitle: 'Direct GET requests to api.commandcode.ai. Alpha endpoints can change; absent metrics remain Unavailable. No CLI session or AI prompt is started.'})];
}

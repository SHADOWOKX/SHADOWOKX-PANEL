// Uses the same credential widgets and connection code as extension Settings.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Adw from 'gi://Adw?version=1';
import {commandCodeSetupRows} from '../modules/ai/commandcodeSetup.js';

const directory = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_path();
const schemaSource = Gio.SettingsSchemaSource.new_from_directory(`${directory}/schemas`,
    Gio.SettingsSchemaSource.get_default(), false);
const schema = schemaSource.lookup('org.gnome.shell.extensions.shadow-panel', false);
const settings = new Gio.Settings({settings_schema: schema});
const app = new Adw.Application({application_id: 'org.gnome.ShadowokxPanel.CommandCodeConnect'});
app.connect('activate', () => {
    const window = new Adw.PreferencesWindow({application: app, title: 'SHADOWOKX · Command Code connection',
        default_width: 750, default_height: 450});
    const page = new Adw.PreferencesPage({title: 'Command Code'});
    const group = new Adw.PreferencesGroup({title: 'Secure live usage setup',
        description: 'Paste your API key into the password field and press its apply arrow. It is never written to configuration files or printed.'});
    for (const row of commandCodeSetupRows(settings, window,
        title => window.add_toast(new Adw.Toast({title})), data => {
            // Deliberately omit account identifiers and all raw API responses.
            print(JSON.stringify({authenticated: true, plan: data.plan, windows: data.windows,
                creditBalances: data.creditBalances, consumption: data.consumption,
                warnings: data.warnings, updatedAt: data.updatedAt}));
        })) group.add(row);
    page.add(group);
    window.add(page);
    window.present();
});
app.run([]);

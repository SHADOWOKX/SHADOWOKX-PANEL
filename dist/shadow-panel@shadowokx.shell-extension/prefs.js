import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {ACCENTS, APP_VERSION, MODULE_IDS, MODULE_META} from './lib/constants.js';
import {isHexColor} from './lib/format.js';
import {canonicalizeModuleSettings} from './lib/moduleConfig.js';
import {normalizeTargetFolder, renderObsidianFilename} from './modules/notes/obsidian.js';
import {normalizeWeatherQuery} from './modules/weather/normalize.js';

function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function comboRow(settings, key, title, options, subtitle = '') {
    const model = new Gtk.StringList();
    for (const option of options)
        model.append(option.label);
    const row = new Adw.ComboRow({title, subtitle, model});
    const selected = options.findIndex(option => option.value === settings.get_string(key));
    row.selected = Math.max(0, selected);
    row.connect('notify::selected', () => {
        const option = options[row.selected];
        if (option)
            settings.set_string(key, option.value);
    });
    return row;
}

function spinRow(settings, key, title, min, max, step, subtitle = '') {
    const row = Adw.SpinRow.new_with_range(min, max, step);
    row.title = title;
    row.subtitle = subtitle;
    row.value = settings.get_int(key);
    row.connect('notify::value', () => settings.set_int(key, Math.round(row.value)));
    return row;
}

function entryRow(settings, key, title, validator = null) {
    const row = new Adw.EntryRow({title, text: settings.get_string(key)});
    row.connect('changed', () => {
        const value = row.text.trim();
        const valid = !validator || validator(value);
        if (valid) {
            row.remove_css_class('error');
            settings.set_string(key, value);
        } else {
            row.add_css_class('error');
        }
    });
    return row;
}

export default class ShadowPanelPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(720, 760);
        window.search_enabled = true;

        window.add(this._generalPage(settings));
        window.add(this._modulesPage(settings));
        window.add(this._appearancePage(settings));
        window.add(this._integrationsPage(settings, window));
        window.add(this._aboutPage(settings));
    }

    _generalPage(settings) {
        const page = new Adw.PreferencesPage({title: 'General', icon_name: 'preferences-system-symbolic'});
        const indicator = new Adw.PreferencesGroup({title: 'Top bar and popup'});
        indicator.add(comboRow(settings, 'panel-placement', 'Top bar placement', [
            {value: 'left', label: 'Left'},
            {value: 'center', label: 'Center'},
            {value: 'right', label: 'Right'},
        ]));
        page.add(indicator);

        const summary = new Adw.PreferencesGroup({
            title: 'Top bar summary',
            description: 'Choose the live information shown beside the Shadow Panel mark. Values collapse automatically on narrow monitors.',
        });
        summary.add(switchRow(
            settings,
            'show-top-bar-text',
            'Show summary values',
            'When disabled, the selected summary items remain as compact icons.'
        ));
        summary.add(switchRow(
            settings,
            'show-codex-summary',
            'Codex remaining',
            'Shows remaining capacity: five-hour first, then weekly as a fallback.'
        ));
        summary.add(switchRow(
            settings,
            'show-weather-summary',
            'Weather temperature',
            'Shows the last successfully retrieved current temperature.'
        ));
        summary.add(switchRow(
            settings,
            'show-notes-summary',
            'Quick Notes',
            'Shows the local note count and keeps Obsidian status available in the popup.'
        ));
        page.add(summary);

        const navigation = new Adw.PreferencesGroup({title: 'Navigation'});
        navigation.add(switchRow(
            settings,
            'remember-last-tab',
            'Remember last module',
            'Reopen the most recently used module.'
        ));
        navigation.add(comboRow(settings, 'default-tab', 'Default module', MODULE_IDS.map(id => ({
            value: id,
            label: MODULE_META[id].name,
        }))));
        page.add(navigation);

        const behavior = new Adw.PreferencesGroup({title: 'Behavior'});
        behavior.add(switchRow(
            settings,
            'refresh-on-open',
            'Refresh stale data on open',
            'Only providers past their configured interval are refreshed.'
        ));
        behavior.add(switchRow(settings, 'animations', 'Subtle animations'));
        behavior.add(switchRow(
            settings,
            'debug',
            'Debug logging',
            'Adds minimal, redacted diagnostics to the user journal.'
        ));
        page.add(behavior);
        return page;
    }

    _modulesPage(settings) {
        const page = new Adw.PreferencesPage({title: 'Modules', icon_name: 'view-grid-symbolic'});
        const group = new Adw.PreferencesGroup({
            title: 'Enabled modules',
            description: 'Use the arrow buttons to change the compact tab order.',
        });
        page.add(group);
        this._renderModuleRows(settings, group);
        return page;
    }

    _renderModuleRows(settings, group) {
        for (const row of group._shadowRows ?? [])
            group.remove(row);
        group._shadowRows = [];
        const canonical = canonicalizeModuleSettings(
            settings.get_strv('module-order'),
            settings.get_strv('enabled-modules')
        );
        const enabled = new Set(canonical.enabled);
        const normalizedOrder = [...canonical.order];

        normalizedOrder.forEach((id, index) => {
            const row = new Adw.ActionRow({
                title: MODULE_META[id].name,
                subtitle: id === 'codex' ? 'Account and remaining capacity from the local Codex app-server' :
                    id === 'weather' ? 'Open-Meteo, no API key' : 'Local Quick Notes with optional Obsidian capture',
                icon_name: MODULE_META[id].icon,
            });
            const up = new Gtk.Button({icon_name: 'go-up-symbolic', valign: Gtk.Align.CENTER});
            up.tooltip_text = 'Move up';
            up.sensitive = index > 0;
            up.connect('clicked', () => {
                [normalizedOrder[index - 1], normalizedOrder[index]] =
                    [normalizedOrder[index], normalizedOrder[index - 1]];
                settings.set_strv('module-order', normalizedOrder);
                this._renderModuleRows(settings, group);
            });
            row.add_suffix(up);
            const down = new Gtk.Button({icon_name: 'go-down-symbolic', valign: Gtk.Align.CENTER});
            down.tooltip_text = 'Move down';
            down.sensitive = index < normalizedOrder.length - 1;
            down.connect('clicked', () => {
                [normalizedOrder[index], normalizedOrder[index + 1]] =
                    [normalizedOrder[index + 1], normalizedOrder[index]];
                settings.set_strv('module-order', normalizedOrder);
                this._renderModuleRows(settings, group);
            });
            row.add_suffix(down);
            const toggle = new Gtk.Switch({active: enabled.has(id), valign: Gtk.Align.CENTER});
            toggle.connect('notify::active', () => {
                if (toggle.active)
                    enabled.add(id);
                else
                    enabled.delete(id);
                settings.set_strv('enabled-modules', MODULE_IDS.filter(moduleId => enabled.has(moduleId)));
            });
            row.add_suffix(toggle);
            row.activatable_widget = toggle;
            group.add(row);
            group._shadowRows.push(row);
        });
    }

    _appearancePage(settings) {
        const page = new Adw.PreferencesPage({title: 'Appearance', icon_name: 'applications-graphics-symbolic'});
        const palette = new Adw.PreferencesGroup({title: 'Color and density'});
        palette.add(comboRow(settings, 'theme', 'Interface contrast', [
            {value: 'auto', label: 'Auto'},
            {value: 'dark', label: 'Dark'},
            {value: 'light', label: 'Light'},
        ], 'Used with the Default background; fixed and custom tints choose readable contrast automatically.'));
        palette.add(comboRow(settings, 'density', 'Density', [
            {value: 'compact', label: 'Compact'},
            {value: 'comfortable', label: 'Comfortable'},
        ]));
        palette.add(comboRow(settings, 'accent-color', 'Accent color', [
            ...Object.keys(ACCENTS).map(value => ({
                value,
                label: value[0].toUpperCase() + value.slice(1),
            })),
            {value: 'custom', label: 'Custom'},
        ], 'Used for selected tabs, progress, and active controls.'));
        palette.add(entryRow(settings, 'custom-accent', 'Custom accent (#RRGGBB)', value => isHexColor(value)));
        page.add(palette);

        const background = new Adw.PreferencesGroup({
            title: 'Background Theme',
            description: 'Neutral treatments keep the dashboard calm while preserving the selected accent.',
        });
        background.add(comboRow(settings, 'background-theme', 'Dashboard background', [
            {value: 'default', label: 'Default'},
            {value: 'claude-gray', label: 'Claude-like Gray'},
            {value: 'dark-graphite', label: 'Dark Graphite'},
            {value: 'light-neutral', label: 'Light Neutral'},
            {value: 'custom', label: 'Custom Tint'},
        ]));
        background.add(entryRow(
            settings,
            'custom-background',
            'Custom background (#RRGGBB)',
            value => isHexColor(value)
        ));
        page.add(background);
        return page;
    }

    _integrationsPage(settings, window) {
        const page = new Adw.PreferencesPage({title: 'Integrations', icon_name: 'network-workgroup-symbolic'});
        const codex = new Adw.PreferencesGroup({title: 'Codex'});
        const codexPath = GLib.find_program_in_path('codex') ||
            (GLib.file_test('/usr/lib/chatgpt/resources/codex', GLib.FileTest.IS_EXECUTABLE)
                ? '/usr/lib/chatgpt/resources/codex'
                : null);
        codex.add(new Adw.ActionRow({
            title: codexPath ? 'Codex detected' : 'Codex not detected',
            subtitle: codexPath
                ? 'Usage is read through the local machine-readable app-server protocol.'
                : 'Install or expose Codex in the GNOME Shell environment.',
            icon_name: codexPath ? 'emblem-ok-symbolic' : 'dialog-warning-symbolic',
        }));
        const codexHandler = Gio.AppInfo.get_default_for_uri_scheme('codex');
        codex.add(new Adw.ActionRow({
            title: 'Open Codex action',
            subtitle: codexHandler
                ? `Uses the registered ${codexHandler.get_display_name()} application.`
                : 'No application currently handles codex:// links.',
            icon_name: codexHandler ? 'external-link-symbolic' : 'dialog-warning-symbolic',
        }));
        codex.add(spinRow(
            settings,
            'codex-refresh-minutes',
            'Refresh interval',
            5,
            120,
            5,
            'Minutes between background refreshes.'
        ));
        page.add(codex);

        const weather = new Adw.PreferencesGroup({title: 'Weather'});
        weather.add(entryRow(
            settings,
            'weather-location',
            'Location',
            value => value.length > 0 && normalizeWeatherQuery(value) === value
        ));
        weather.add(comboRow(settings, 'weather-unit', 'Temperature unit', [
            {value: 'celsius', label: 'Celsius'},
            {value: 'fahrenheit', label: 'Fahrenheit'},
        ]));
        weather.add(spinRow(
            settings,
            'weather-refresh-minutes',
            'Refresh interval',
            15,
            180,
            5,
            'Minutes between Open-Meteo requests.'
        ));
        page.add(weather);

        const notes = new Adw.PreferencesGroup({
            title: 'Quick Notes and Obsidian',
            description: 'Shadow Panel only writes a new Markdown file inside the vault and folder you select. It does not scan or index the vault.',
        });
        const vaultRow = entryRow(
            settings,
            'obsidian-vault-path',
            'Obsidian vault',
            value => value === '' || (GLib.path_is_absolute(value) &&
                !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value))
        );
        const chooseVault = new Gtk.Button({
            icon_name: 'folder-open-symbolic',
            tooltip_text: 'Choose Obsidian vault',
            valign: Gtk.Align.CENTER,
        });
        chooseVault.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({title: 'Choose an Obsidian vault'});
            dialog.select_folder(window, null, (_dialog, result) => {
                try {
                    const selected = dialog.select_folder_finish(result);
                    const path = selected?.get_path();
                    if (path)
                        vaultRow.text = path;
                } catch {
                    // Closing the chooser leaves the current path unchanged.
                }
            });
        });
        vaultRow.add_suffix(chooseVault);
        notes.add(vaultRow);
        notes.add(entryRow(
            settings,
            'obsidian-target-folder',
            'Target folder inside vault',
            value => {
                try {
                    normalizeTargetFolder(value);
                    return true;
                } catch {
                    return false;
                }
            }
        ));
        notes.add(entryRow(
            settings,
            'obsidian-filename-pattern',
            'Filename pattern',
            value => {
                try {
                    renderObsidianFilename(value);
                    return true;
                } catch {
                    return false;
                }
            }
        ));
        notes.add(comboRow(settings, 'notes-save-mode', 'Quick Capture destination', [
            {value: 'local', label: 'Local Notes'},
            {value: 'obsidian', label: 'Obsidian'},
            {value: 'both', label: 'Local Notes and Obsidian'},
        ], 'Controls the primary Save button; an explicit Obsidian action remains available when connected.'));
        page.add(notes);
        return page;
    }

    _aboutPage(settings) {
        const page = new Adw.PreferencesPage({title: 'About', icon_name: 'help-about-symbolic'});
        const group = new Adw.PreferencesGroup({title: 'Shadow Panel'});
        group.add(new Adw.ActionRow({title: 'Version', subtitle: APP_VERSION}));
        group.add(new Adw.ActionRow({title: 'Compatibility', subtitle: 'Ubuntu 26.04.1 · GNOME Shell 50'}));
        group.add(new Adw.ActionRow({
            title: 'Privacy',
            subtitle: 'No telemetry. Quick Notes stay local unless you explicitly enable Obsidian saving. Weather is sent only to Open-Meteo.',
        }));
        const diagnostics = new Adw.ActionRow({
            title: 'Diagnostics',
            subtitle: 'Copy a credential-free environment summary.',
        });
        const copy = new Gtk.Button({label: 'Copy', valign: Gtk.Align.CENTER});
        copy.connect('clicked', () => {
            const enabled = settings.get_strv('enabled-modules').join(', ') || 'none';
            const text = [
                `Shadow Panel ${APP_VERSION}`,
                'GNOME Shell target: 50',
                `OS: ${GLib.get_os_info('PRETTY_NAME') ?? 'Unknown'}`,
                `Enabled modules: ${enabled}`,
                `Density: ${settings.get_string('density')}`,
                `Theme: ${settings.get_string('theme')}`,
                `Background: ${settings.get_string('background-theme')}`,
                `Obsidian configured: ${settings.get_string('obsidian-vault-path') ? 'yes' : 'no'}`,
                `Debug logging: ${settings.get_boolean('debug')}`,
            ].join('\n');
            Gdk.Display.get_default().get_clipboard().set(text);
        });
        diagnostics.add_suffix(copy);
        group.add(diagnostics);
        page.add(group);
        return page;
    }
}

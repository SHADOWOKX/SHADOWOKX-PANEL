import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {ACCENTS, APP_VERSION, MODULE_IDS, MODULE_META} from './lib/constants.js';
import {isHexColor} from './lib/format.js';
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
    row.selected = Math.max(0, options.findIndex(option =>
        option.value === settings.get_string(key)));
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

function entryRow(settings, key, title, validator, transform = value => value) {
    const row = new Adw.EntryRow({title, text: settings.get_string(key)});
    row.connect('changed', () => {
        const rawValue = row.text.trim();
        const value = transform(rawValue);
        if (rawValue && validator(value)) {
            row.remove_css_class('error');
            settings.set_string(key, value);
        } else {
            row.add_css_class('error');
        }
    });
    return row;
}

function addToast(window, title) {
    window.add_toast(new Adw.Toast({title, timeout: 3}));
}

export default class ShadowPanelPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(700, 720);
        window.search_enabled = true;

        window.add(this._generalPage(settings));
        window.add(this._appearancePage(settings));
        window.add(this._codexPage(settings, window));
        window.add(this._weatherPage(settings));
        window.add(this._aboutPage(settings));
    }

    _generalPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        });
        const panel = new Adw.PreferencesGroup({title: 'Panel'});
        panel.add(comboRow(settings, 'panel-placement', 'Top bar placement', [
            {value: 'left', label: 'Left'},
            {value: 'center', label: 'Center'},
            {value: 'right', label: 'Right'},
        ]));
        panel.add(comboRow(settings, 'default-tab', 'Default page', MODULE_IDS.map(id => ({
            value: id,
            label: MODULE_META[id].name,
        }))));
        panel.add(switchRow(settings, 'remember-last-tab', 'Remember last page'));
        panel.add(switchRow(
            settings,
            'refresh-on-open',
            'Refresh stale data when opened',
            'Only refreshes a provider after its configured interval has elapsed.'
        ));
        page.add(panel);

        const codex = new Adw.PreferencesGroup({title: 'Top bar · Codex'});
        codex.add(switchRow(settings, 'show-codex-icon', 'Show ChatGPT icon'));
        codex.add(switchRow(settings, 'show-codex-remaining', 'Show remaining percentage'));
        codex.add(switchRow(
            settings,
            'show-codex-reset-countdown',
            'Show reset countdown',
            'Uses the weekly reset window.'
        ));
        page.add(codex);

        const weather = new Adw.PreferencesGroup({title: 'Top bar · Weather'});
        weather.add(switchRow(settings, 'show-weather-icon', 'Show weather icon'));
        weather.add(switchRow(settings, 'show-weather-temperature', 'Show temperature'));
        weather.add(switchRow(settings, 'show-weather-condition', 'Show condition text'));
        page.add(weather);
        return page;
    }

    _appearancePage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'applications-graphics-symbolic',
        });
        const interfaceGroup = new Adw.PreferencesGroup({title: 'Interface'});
        interfaceGroup.add(comboRow(settings, 'theme', 'Theme', [
            {value: 'auto', label: 'Auto'},
            {value: 'dark', label: 'Dark'},
            {value: 'light', label: 'Light'},
        ], 'Auto follows GNOME; Dark and Light recolor every background preset.'));
        interfaceGroup.add(comboRow(settings, 'background-theme', 'Background', [
            {value: 'claude-gray', label: 'Claude Gray'},
            {value: 'graphite', label: 'Graphite'},
            {value: 'gnome', label: 'GNOME'},
            {value: 'light-neutral', label: 'Light Neutral'},
        ], 'Neutral surfaces remain readable in both light and dark modes.'));
        interfaceGroup.add(comboRow(settings, 'density', 'Density', [
            {value: 'comfortable', label: 'Comfortable'},
            {value: 'compact', label: 'Compact'},
        ]));
        interfaceGroup.add(comboRow(settings, 'panel-width', 'Panel width', [
            {value: 'narrow', label: 'Narrow'},
            {value: 'standard', label: 'Standard'},
            {value: 'wide', label: 'Wide'},
        ], 'Use Wide for long place names and more forecast space.'));
        interfaceGroup.add(switchRow(
            settings,
            'animations',
            'Animations',
            'Subtle 120–180 ms transitions only.'
        ));
        page.add(interfaceGroup);

        const accent = new Adw.PreferencesGroup({
            title: 'Accent',
            description: 'Applied only to progress, selected controls, and important values.',
        });
        accent.add(comboRow(settings, 'accent-color', 'Color', [
            ...Object.keys(ACCENTS).map(value => ({
                value,
                label: value[0].toUpperCase() + value.slice(1),
            })),
            {value: 'custom', label: 'Custom'},
        ]));
        accent.add(entryRow(
            settings,
            'custom-accent',
            'Custom accent (#RRGGBB)',
            value => isHexColor(value)
        ));
        page.add(accent);
        return page;
    }

    _codexPage(settings, window) {
        const page = new Adw.PreferencesPage({title: 'Codex', icon_name: 'system-run-symbolic'});
        const content = new Adw.PreferencesGroup({title: 'Usage page'});
        content.add(switchRow(settings, 'show-codex-weekly', 'Show weekly limit'));
        content.add(switchRow(settings, 'show-codex-five-hour', 'Show five-hour window'));
        content.add(switchRow(settings, 'show-codex-reset-time', 'Show reset times'));
        content.add(spinRow(
            settings,
            'codex-refresh-minutes',
            'Automatic refresh interval',
            5,
            120,
            5,
            'Minutes between local app-server requests.'
        ));
        page.add(content);

        const activity = new Adw.PreferencesGroup({
            title: 'Token activity',
            description: 'Only locally reported Codex usage is displayed.',
        });
        activity.add(switchRow(settings, 'show-codex-token-lifetime', 'Lifetime total'));
        activity.add(switchRow(settings, 'show-codex-token-stats', 'Daily statistics and chart'));
        activity.add(switchRow(
            settings,
            'show-codex-insights',
            'Data-backed insights',
            'Insights are hidden automatically when daily history is insufficient.'
        ));
        page.add(activity);

        const executable = GLib.find_program_in_path('codex') ||
            (GLib.file_test('/usr/lib/chatgpt/resources/codex', GLib.FileTest.IS_EXECUTABLE)
                ? '/usr/lib/chatgpt/resources/codex'
                : null);
        const handler = Gio.AppInfo.get_default_for_uri_scheme('codex');
        const app = new Adw.PreferencesGroup({title: 'Codex application'});
        const status = new Adw.ActionRow({
            title: executable ? 'Provider detected' : 'Provider not detected',
            subtitle: executable
                ? 'Usage is read through the local Codex app-server.'
                : 'Install Codex or expose it to the GNOME Shell environment.',
            icon_name: executable ? 'emblem-ok-symbolic' : 'dialog-warning-symbolic',
        });
        app.add(status);
        const open = new Adw.ActionRow({
            title: 'Open Codex',
            subtitle: handler
                ? `Auto-detected ${handler.get_display_name()}.`
                : 'No application handles codex:// links.',
        });
        const testButton = new Gtk.Button({label: 'Test', valign: Gtk.Align.CENTER});
        testButton.sensitive = Boolean(handler);
        testButton.connect('clicked', () => {
            Gio.AppInfo.launch_default_for_uri_async('codex://', null, null, (_source, result) => {
                try {
                    Gio.AppInfo.launch_default_for_uri_finish(result);
                    addToast(window, 'Codex opened');
                } catch {
                    addToast(window, 'Codex could not be opened');
                }
            });
        });
        open.add_suffix(testButton);
        app.add(open);
        page.add(app);
        return page;
    }

    _weatherPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Weather',
            icon_name: 'weather-clear-symbolic',
        });
        const provider = new Adw.PreferencesGroup({title: 'Open-Meteo'});
        provider.add(entryRow(
            settings,
            'weather-location',
            'Location',
            value => value.length > 0,
            normalizeWeatherQuery
        ));
        provider.add(comboRow(settings, 'weather-unit', 'Temperature unit', [
            {value: 'celsius', label: 'Celsius'},
            {value: 'fahrenheit', label: 'Fahrenheit'},
        ]));
        provider.add(comboRow(settings, 'weather-wind-unit', 'Wind unit', [
            {value: 'kmh', label: 'Kilometres per hour'},
            {value: 'mph', label: 'Miles per hour'},
        ]));
        provider.add(spinRow(
            settings,
            'weather-refresh-minutes',
            'Automatic refresh interval',
            15,
            180,
            5,
            'Minutes between requests. The last valid forecast stays visible offline.'
        ));
        page.add(provider);

        const details = new Adw.PreferencesGroup({
            title: 'Details',
            description: 'Unavailable values are hidden automatically.',
        });
        details.add(switchRow(settings, 'show-weather-feels-like', 'Feels like'));
        details.add(switchRow(settings, 'show-weather-humidity', 'Humidity'));
        details.add(switchRow(settings, 'show-weather-wind', 'Wind'));
        details.add(switchRow(settings, 'show-weather-rain', 'Rain probability'));
        details.add(switchRow(settings, 'show-weather-uv', 'UV index'));
        details.add(switchRow(settings, 'show-weather-sun-times', 'Sunrise and sunset'));
        details.add(switchRow(
            settings,
            'show-weather-insights',
            'Forecast insight',
            'Uses only the returned hourly precipitation forecast.'
        ));
        page.add(details);
        return page;
    }

    _aboutPage(settings) {
        const page = new Adw.PreferencesPage({title: 'About', icon_name: 'help-about-symbolic'});
        const about = new Adw.PreferencesGroup({title: 'Shadowokx Panel'});
        about.add(new Adw.ActionRow({title: 'Version', subtitle: APP_VERSION}));
        about.add(new Adw.ActionRow({
            title: 'Compatibility',
            subtitle: 'Ubuntu 26.04.1 · GNOME Shell 50 · Wayland',
        }));
        about.add(new Adw.ActionRow({
            title: 'Privacy',
            subtitle: 'No telemetry. Codex limits stay local; only the configured location is sent to Open-Meteo.',
        }));
        const diagnostics = new Adw.ActionRow({
            title: 'Diagnostics',
            subtitle: 'Copy a credential-free environment summary.',
        });
        const copy = new Gtk.Button({label: 'Copy', valign: Gtk.Align.CENTER});
        copy.connect('clicked', () => {
            const text = [
                `Shadowokx Panel ${APP_VERSION}`,
                'Modules: ChatGPT Codex, Weather',
                'GNOME Shell target: 50',
                `OS: ${GLib.get_os_info('PRETTY_NAME') ?? 'Unknown'}`,
                `Density: ${settings.get_string('density')}`,
                `Theme: ${settings.get_string('theme')}`,
                `Background: ${settings.get_string('background-theme')}`,
                `Debug logging: ${settings.get_boolean('debug')}`,
            ].join('\n');
            Gdk.Display.get_default().get_clipboard().set(text);
        });
        diagnostics.add_suffix(copy);
        about.add(diagnostics);
        about.add(switchRow(settings, 'debug', 'Debug logging', 'Redacted and disabled by default.'));
        page.add(about);
        return page;
    }
}

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {CodexProvider} from './modules/codex/provider.js';
import {WeatherProvider} from './modules/weather/provider.js';
import {Logger} from './services/logger.js';
import {Scheduler} from './services/scheduler.js';
import {ShadowIndicator} from './ui/panel.js';

const REBUILD_KEYS = Object.freeze([
    'panel-placement',
    'show-codex-icon',
    'show-codex-remaining',
    'show-codex-reset-countdown',
    'show-weather-icon',
    'show-weather-temperature',
    'show-weather-condition',
    'remember-last-tab',
    'default-tab',
    'animations',
    'density',
    'panel-width',
    'theme',
    'background-theme',
    'accent-color',
    'custom-accent',
    'show-codex-weekly',
    'show-codex-five-hour',
    'show-codex-reset-time',
    'show-codex-token-lifetime',
    'show-codex-token-stats',
    'show-codex-insights',
    'show-weather-feels-like',
    'show-weather-humidity',
    'show-weather-wind',
    'weather-wind-unit',
    'show-weather-rain',
    'show-weather-uv',
    'show-weather-sun-times',
    'show-weather-insights',
]);

export default class ShadowPanelExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._logger = new Logger(this._settings);
        this._scheduler = new Scheduler(this._logger);
        this._services = {};
        this._settingsIds = REBUILD_KEYS.map(key =>
            this._settings.connect(`changed::${key}`, () => this._queueRebuild()));
        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._interfaceSettingsId = this._interfaceSettings.connect(
            'changed::text-scaling-factor',
            () => this._queueRebuild()
        );
        this._rebuildId = 0;
        this._rebuildPending = false;
        this._createIndicator();
    }

    _queueRebuild() {
        this._rebuildPending = true;
        if (this._indicator?.menu?.isOpen)
            return;
        if (this._rebuildId)
            return;
        this._rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._rebuildId = 0;
            if (this._indicator?.menu?.isOpen)
                return GLib.SOURCE_REMOVE;
            this._rebuildPending = false;
            this._destroyIndicator();
            // Panel roles are released from GNOME Shell's status-area map on
            // actor destruction. Recreate on the next idle so a replacement
            // is never rejected and disposed as a duplicate role.
            this._rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._rebuildId = 0;
                if (!this._settings)
                    return GLib.SOURCE_REMOVE;
                try {
                    this._createIndicator();
                } catch (error) {
                    this._logger?.warn('Could not rebuild Shadowokx Panel', error);
                }
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _flushPendingRebuild() {
        if (this._rebuildPending)
            this._queueRebuild();
    }

    _ensureServices() {
        if (!this._services.codexProvider) {
            const provider = new CodexProvider(this._settings, this._scheduler, this._logger);
            this._services.codexProvider = provider;
            provider.start().catch(error =>
                this._logger.warn('Could not start Codex provider', error));
        }
        if (!this._services.weatherProvider) {
            const provider = new WeatherProvider(this._settings, this._scheduler, this._logger);
            this._services.weatherProvider = provider;
            provider.start().catch(error =>
                this._logger.warn('Could not start weather provider', error));
        }
    }

    getRuntimeServices() {
        return {...this._services, scheduler: this._scheduler};
    }

    _createIndicator() {
        this._ensureServices();
        const replacement = new ShadowIndicator(
            this,
            this._settings,
            this._logger
        );
        this._indicator = replacement;
        const placement = this._settings.get_string('panel-placement');
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, placement);
    }

    _destroyIndicator() {
        const indicator = this._indicator;
        this._indicator = null;
        indicator?.destroy();
    }

    disable() {
        if (this._rebuildId)
            GLib.Source.remove(this._rebuildId);
        this._rebuildId = 0;
        this._rebuildPending = false;
        this._destroyIndicator();
        for (const service of Object.values(this._services ?? {}))
            service.destroy?.();
        this._services = {};
        this._scheduler?.destroy();
        this._scheduler = null;
        for (const id of this._settingsIds ?? [])
            this._settings.disconnect(id);
        this._settingsIds = [];
        if (this._interfaceSettingsId)
            this._interfaceSettings.disconnect(this._interfaceSettingsId);
        this._interfaceSettingsId = 0;
        this._interfaceSettings = null;
        this._logger = null;
        this._settings = null;
    }
}

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
    'show-weather-panel',
    'show-weather-top-bar',
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

const LIVE_INDICATOR_KEYS = Object.freeze([
    'show-codex-icon',
    'show-codex-remaining',
    'show-codex-reset-countdown',
    'show-codex-usage-state',
    'show-weather-icon',
    'show-weather-temperature',
    'show-weather-condition',
]);

// Preference windows can update several related keys in one interaction.
// A short debounce keeps those bursts to one actor-tree rebuild and lets
// GNOME finish the current style pass before the old indicator is destroyed.
const REBUILD_DEBOUNCE_MS = 100;
const REBUILD_MOUNT_MAX_POLLS = 40;
const STATUS_AREA_RELEASE_POLL_MS = 25;
const STATUS_AREA_RELEASE_MAX_POLLS = 40;

export default class ShadowPanelExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._logger = new Logger(this._settings);
        this._scheduler = new Scheduler(this._logger);
        this._services = {};
        this._settingsIds = [
            ...REBUILD_KEYS.map(key =>
                this._settings.connect(`changed::${key}`, () => this._queueRebuild())),
            ...LIVE_INDICATOR_KEYS.map(key =>
                this._settings.connect(`changed::${key}`, () =>
                    this._indicator?.syncIndicatorSettings())),
        ];
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
        let mountPolls = 0;
        this._rebuildId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            REBUILD_DEBOUNCE_MS,
            () => {
                if (!this._settings) {
                    this._rebuildId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                if (this._indicator?.menu?.isOpen) {
                    this._rebuildId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                // A headless or freshly-started Shell can report the extension
                // active just before its panel actor reaches the stage. Never
                // destroy that actor while GNOME is still performing its first
                // style pass.
                if (this._indicator && !this._indicator.mapped &&
                    mountPolls++ < REBUILD_MOUNT_MAX_POLLS)
                    return GLib.SOURCE_CONTINUE;
                if (this._indicator && !this._indicator.mapped) {
                    this._rebuildId = 0;
                    this._logger?.warn('Shadowokx panel actor did not reach the stage');
                    return GLib.SOURCE_REMOVE;
                }
                this._rebuildId = 0;
                this._rebuildPending = false;
                this._destroyIndicator();
                // GNOME releases panel roles asynchronously. Wait until the
                // status-area map confirms the old role is gone so a replacement
                // can never be accepted and then immediately disposed as a
                // duplicate during a burst of preference changes.
                let releasePolls = 0;
                this._rebuildId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    STATUS_AREA_RELEASE_POLL_MS,
                    () => {
                        if (!this._settings) {
                            this._rebuildId = 0;
                            return GLib.SOURCE_REMOVE;
                        }
                        if (Main.panel.statusArea[this.uuid] &&
                            releasePolls++ < STATUS_AREA_RELEASE_MAX_POLLS)
                            return GLib.SOURCE_CONTINUE;
                        if (Main.panel.statusArea[this.uuid]) {
                            this._rebuildId = 0;
                            this._rebuildPending = true;
                            this._logger?.warn('GNOME did not release the Shadowokx panel role');
                            return GLib.SOURCE_REMOVE;
                        }
                        this._rebuildId = 0;
                        this._rebuildPending = false;
                        try {
                            this._createIndicator();
                        } catch (error) {
                            this._logger?.warn('Could not rebuild Shadowokx Panel', error);
                        }
                        return GLib.SOURCE_REMOVE;
                    }
                );
                return GLib.SOURCE_REMOVE;
            }
        );
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
        const needsWeather = this._settings.get_boolean('show-weather-panel') ||
            this._settings.get_boolean('show-weather-top-bar');
        if (needsWeather && !this._services.weatherProvider) {
            const provider = new WeatherProvider(this._settings, this._scheduler, this._logger);
            this._services.weatherProvider = provider;
            provider.start().catch(error =>
                this._logger.warn('Could not start weather provider', error));
        } else if (!needsWeather && this._services.weatherProvider) {
            this._services.weatherProvider.destroy();
            delete this._services.weatherProvider;
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
        replacement.completeMount();
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

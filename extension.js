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
    'theme',
    'background-theme',
    'accent-color',
    'custom-accent',
    'show-codex-weekly',
    'show-codex-five-hour',
    'show-codex-reset-time',
    'show-weather-feels-like',
    'show-weather-humidity',
    'show-weather-wind',
    'show-weather-rain',
    'show-weather-uv',
    'show-weather-sun-times',
]);

export default class ShadowPanelExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._logger = new Logger(this._settings);
        this._scheduler = new Scheduler(this._logger);
        this._services = {};
        this._settingsIds = REBUILD_KEYS.map(key =>
            this._settings.connect(`changed::${key}`, () => this._queueRebuild()));
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
            try {
                this._createIndicator();
            } catch (error) {
                this._logger?.warn('Could not rebuild Shadow Panel', error);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _flushPendingRebuild() {
        if (this._rebuildPending)
            this._queueRebuild();
    }

    _serviceNeeds() {
        return {
            codex: true,
            weather: true,
        };
    }

    _ensureServices() {
        const needs = this._serviceNeeds();
        if (needs.codex && !this._services.codexProvider) {
            const provider = new CodexProvider(this._settings, this._scheduler, this._logger);
            this._services.codexProvider = provider;
            provider.start().catch(error =>
                this._logger.warn('Could not start Codex provider', error));
        }
        if (needs.weather && !this._services.weatherProvider) {
            const provider = new WeatherProvider(this._settings, this._scheduler, this._logger);
            this._services.weatherProvider = provider;
            provider.start().catch(error =>
                this._logger.warn('Could not start weather provider', error));
        }
        return needs;
    }

    _releaseUnusedProviders(needs) {
        if (!needs.codex && this._services.codexProvider) {
            this._services.codexProvider.destroy();
            delete this._services.codexProvider;
        }
        if (!needs.weather && this._services.weatherProvider) {
            this._services.weatherProvider.destroy();
            delete this._services.weatherProvider;
        }
    }

    getRuntimeServices() {
        return {...this._services, scheduler: this._scheduler};
    }

    _createIndicator() {
        const needs = this._ensureServices();
        const replacement = new ShadowIndicator(
            this,
            this._settings,
            this._logger
        );
        this._indicator?.destroy();
        this._indicator = replacement;
        const placement = this._settings.get_string('panel-placement');
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, placement);
        this._releaseUnusedProviders(needs);
    }

    disable() {
        if (this._rebuildId)
            GLib.Source.remove(this._rebuildId);
        this._rebuildId = 0;
        this._rebuildPending = false;
        this._indicator?.destroy();
        this._indicator = null;
        for (const service of Object.values(this._services ?? {}))
            service.destroy?.();
        this._services = {};
        this._scheduler?.destroy();
        this._scheduler = null;
        for (const id of this._settingsIds ?? [])
            this._settings.disconnect(id);
        this._settingsIds = [];
        this._logger = null;
        this._settings = null;
    }
}

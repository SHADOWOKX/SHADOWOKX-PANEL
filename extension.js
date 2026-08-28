import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {MODULE_IDS} from './lib/constants.js';
import {canonicalizeModuleSettings} from './lib/moduleConfig.js';
import {CodexProvider} from './modules/codex/provider.js';
import {NoteStore} from './modules/notes/store.js';
import {ObsidianService} from './modules/notes/obsidian.js';
import {WeatherProvider} from './modules/weather/provider.js';
import {Logger} from './services/logger.js';
import {Scheduler} from './services/scheduler.js';
import {ShadowIndicator} from './ui/panel.js';

const REBUILD_KEYS = Object.freeze([
    'panel-placement',
    'show-top-bar-text',
    'show-codex-summary',
    'show-weather-summary',
    'show-notes-summary',
    'remember-last-tab',
    'default-tab',
    'animations',
    'density',
    'enabled-modules',
    'module-order',
    'theme',
    'background-theme',
    'custom-background',
    'accent-color',
    'custom-accent',
]);

export default class ShadowPanelExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._migrateModuleSettings();
        this._logger = new Logger(this._settings);
        this._scheduler = new Scheduler(this._logger);
        this._services = {};
        this._settingsIds = REBUILD_KEYS.map(key =>
            this._settings.connect(`changed::${key}`, () => this._queueRebuild()));
        this._rebuildId = 0;
        this._rebuildPending = false;
        this._createIndicator();
    }

    _migrateModuleSettings() {
        const allowed = new Set(MODULE_IDS);
        const {enabled, order} = canonicalizeModuleSettings(
            this._settings.get_strv('module-order'),
            this._settings.get_strv('enabled-modules')
        );
        this._settings.set_strv('enabled-modules', enabled);
        this._settings.set_strv('module-order', order);
        if (!allowed.has(this._settings.get_string('default-tab')))
            this._settings.set_string('default-tab', 'codex');
        if (!allowed.has(this._settings.get_string('last-selected-tab')))
            this._settings.set_string('last-selected-tab', 'codex');
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
        const enabled = new Set(this._settings.get_strv('enabled-modules'));
        return {
            codex: enabled.has('codex') || this._settings.get_boolean('show-codex-summary'),
            weather: enabled.has('weather') || this._settings.get_boolean('show-weather-summary'),
            notes: enabled.has('notes') || this._settings.get_boolean('show-notes-summary'),
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
        // Notes services are intentionally retained once created. They do no
        // polling, and keeping one store instance prevents a UI-only rebuild
        // from racing an in-flight atomic note write.
        if (needs.notes && !this._services.noteStore) {
            const store = new NoteStore(this._logger);
            const obsidian = new ObsidianService(this._settings, this._logger);
            this._services.noteStore = store;
            this._services.obsidianService = obsidian;
            store.start().catch(error => this._logger.warn('Could not load notes', error));
            obsidian.start().catch(error =>
                this._logger.warn('Could not validate Obsidian integration', error));
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
        const transientState = this._indicator?.getTransientState?.() ?? null;
        const needs = this._ensureServices();
        const replacement = new ShadowIndicator(
            this,
            this._settings,
            this._logger,
            transientState
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

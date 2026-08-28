import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ACCENTS, MODULE_META} from '../lib/constants.js';
import {chooseInitialModule, resolveModuleOrder} from '../lib/moduleConfig.js';
import {codexRemainingSummary, notesSummaryCount, weatherSummaryTemperature} from '../lib/summary.js';
import {PAGE_FACTORIES} from '../modules/index.js';
import {
    iconButton,
    isLightColor,
    moduleIcon,
    pageTitle,
    resolveAccent,
    resolveCustomBackground,
    stateMessage,
    textButton,
} from './components.js';
import {TabStrip} from './tabs.js';

export const ShadowIndicator = GObject.registerClass(
class ShadowIndicator extends PanelMenu.Button {
    _init(extension, settings, logger, transientState = null) {
        super._init(0.5, 'Shadow Panel', false);
        this._extension = extension;
        this._settings = settings;
        this._logger = logger;
        this._transientState = transientState ?? {};
        this._scheduler = extension.getRuntimeServices().scheduler;
        this._pages = new Map();
        this._subscriptions = [];
        this._activeId = null;
        this._popupOpen = false;

        this._visibleIds = resolveModuleOrder(
            settings.get_strv('module-order'),
            settings.get_strv('enabled-modules')
        );
        this._buildIndicator();
        this._buildDashboard();
        this._createServicesAndPages();
        if (settings.get_string('theme') === 'auto' &&
            settings.get_string('background-theme') === 'default') {
            const shellSettings = St.Settings.get();
            const colorSchemeId = shellSettings.connect('notify::color-scheme', () =>
                this._extension._queueRebuild());
            this._subscriptions.push(() => shellSettings.disconnect(colorSchemeId));
        }
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._onPopupOpened();
            else
                this._onPopupClosed();
        });
    }

    _buildIndicator() {
        this._summaryActors = new Map();
        this._indicatorBox = new St.BoxLayout({style_class: 'shadow-panel-indicator'});
        this._fallbackIcon = moduleIcon(this._extension, 'codex', 15, 'shadow-panel-mark');
        this._fallbackIcon.style = `color: ${resolveAccent(this._settings)};`;
        this._indicatorBox.add_child(this._fallbackIcon);

        this._addSummaryItem('codex', 'Codex remaining usage');
        this._addSummaryItem('weather', 'Weather temperature');
        this._addSummaryItem('notes', 'Quick Notes');
        this.add_child(this._indicatorBox);
        const monitorsChangedId = Main.layoutManager.connect('monitors-changed', () =>
            this._syncIndicator());
        this._subscriptions.push(() => Main.layoutManager.disconnect(monitorsChangedId));
        this._syncIndicator();
    }

    _addSummaryItem(id, accessibleName) {
        const item = new St.BoxLayout({
            style_class: `shadow-panel-summary-item shadow-panel-summary-${id}`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const icon = moduleIcon(this._extension, id, 14, 'shadow-panel-summary-icon');
        const label = new St.Label({
            text: '',
            style_class: 'shadow-panel-summary-value',
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.hide();
        item.add_child(icon);
        item.add_child(label);
        item.hide();
        item.accessible_name = accessibleName;
        this._indicatorBox.add_child(item);
        this._summaryActors.set(id, {item, icon, label, value: null, accessibleName});
    }

    _buildDashboard() {
        const density = this._settings.get_string('density');
        const theme = this._settings.get_string('theme');
        const backgroundTheme = this._settings.get_string('background-theme');
        const customBackground = resolveCustomBackground(this._settings);
        let effectiveTheme;
        if (backgroundTheme === 'light-neutral')
            effectiveTheme = 'light';
        else if (backgroundTheme === 'claude-gray' || backgroundTheme === 'dark-graphite')
            effectiveTheme = 'dark';
        else if (customBackground)
            effectiveTheme = isLightColor(customBackground) ? 'light' : 'dark';
        else if (theme !== 'auto')
            effectiveTheme = theme;
        else
            effectiveTheme = St.Settings.get().color_scheme === St.SystemColorScheme.PREFER_LIGHT
                ? 'light'
                : 'dark';
        const configuredAccent = this._settings.get_string('accent-color');
        const accentClass = Object.hasOwn(ACCENTS, configuredAccent)
            ? configuredAccent
            : 'custom';
        this._root = new St.BoxLayout({
            vertical: true,
            style_class: `shadow-dashboard shadow-${density}` +
                ` shadow-theme-${effectiveTheme}` +
                ` shadow-bg-${backgroundTheme}` +
                ` shadow-accent-${accentClass}`,
        });
        if (customBackground)
            this._root.style = `background-color: ${customBackground};`;

        const header = new St.BoxLayout({style_class: 'shadow-header', x_expand: true});
        const brand = new St.BoxLayout({style_class: 'shadow-brand', x_expand: true});
        const brandIcon = moduleIcon(this._extension, 'codex', 18, 'shadow-brand-icon');
        brandIcon.style = `color: ${resolveAccent(this._settings)};`;
        brand.add_child(brandIcon);
        const brandCopy = new St.BoxLayout({style_class: 'shadow-brand-copy', x_expand: true});
        brandCopy.add_child(new St.Label({
            text: 'Shadowokx Panel',
            style_class: 'shadow-title',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        brandCopy.add_child(new St.Label({
            text: '™',
            style_class: 'shadow-title-mark',
            y_align: Clutter.ActorAlign.START,
        }));
        brand.add_child(brandCopy);
        header.add_child(brand);
        header.add_child(iconButton('emblem-system-symbolic', 'Shadow Panel settings', () => {
            this.menu.close();
            this._extension.openPreferences();
        }));
        this._root.add_child(header);

        this._tabs = new TabStrip(this._extension, this._settings, this._visibleIds, id => this._select(id));
        this._root.add_child(this._tabs.actor);

        const height = density === 'compact' ? 352 : 392;
        this._pageStack = new St.Widget({
            style_class: 'shadow-page-stack',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            height,
        });
        this._root.add_child(this._pageStack);

        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'shadow-menu-item',
        });
        item.add_child(this._root);
        this.menu.addMenuItem(item);
    }

    _createServicesAndPages() {
        const services = this._extension.getRuntimeServices();
        const context = {
            extension: this._extension,
            settings: this._settings,
            scheduler: services.scheduler,
            logger: this._logger,
            notesTransientState: this._transientState.notes ?? null,
        };
        const needsCodex = this._visibleIds.includes('codex') ||
            this._settings.get_boolean('show-codex-summary');
        if (needsCodex) {
            context.codexProvider = services.codexProvider;
            this._subscriptions.push(context.codexProvider.subscribe(state =>
                this._updateCodexSummary(state)));
        }
        const needsWeather = this._visibleIds.includes('weather') ||
            this._settings.get_boolean('show-weather-summary');
        if (needsWeather) {
            context.weatherProvider = services.weatherProvider;
            this._subscriptions.push(context.weatherProvider.subscribe(state =>
                this._updateWeatherSummary(state)));
        }
        const needsNotes = this._visibleIds.includes('notes') ||
            this._settings.get_boolean('show-notes-summary');
        if (needsNotes) {
            context.noteStore = services.noteStore;
            context.obsidianService = services.obsidianService;
            this._subscriptions.push(context.noteStore.subscribe(notes => {
                this._notes = notes;
                this._updateNotesSummary(context.noteStore.getStatus());
            }));
            this._subscriptions.push(context.obsidianService.subscribe(state => {
                this._obsidianState = state;
                this._updateNotesSummary(context.noteStore.getStatus());
            }));
        }

        for (const id of this._visibleIds) {
            try {
                const page = PAGE_FACTORIES[id](context);
                page.actor.hide();
                this._pageStack.add_child(page.actor);
                this._pages.set(id, page);
            } catch (error) {
                this._logger.warn(`Could not create ${id} page`, error);
                const page = this._moduleErrorPage(id);
                page.actor.hide();
                this._pageStack.add_child(page.actor);
                this._pages.set(id, page);
            }
        }

        this._tabs.setModules([...this._pages.keys()]);

        if (this._pages.size === 0) {
            const empty = stateMessage(
                'view-grid-symbolic',
                'No modules enabled',
                'Enable a module in Shadow Panel preferences.'
            );
            this._pageStack.add_child(empty);
        }

        const availableIds = [...this._pages.keys()];
        const initial = chooseInitialModule(
            availableIds,
            this._settings.get_boolean('remember-last-tab'),
            this._settings.get_string('last-selected-tab'),
            this._settings.get_string('default-tab')
        );
        if (initial)
            this._select(initial);
    }

    _moduleErrorPage(id) {
        const actor = new St.BoxLayout({
            vertical: true,
            style_class: `shadow-page shadow-page-${id}`,
            x_expand: true,
            y_expand: true,
        });
        actor.add_child(pageTitle(MODULE_META[id]?.name ?? 'Module'));
        actor.add_child(stateMessage(
            'dialog-warning-symbolic',
            `${MODULE_META[id]?.name ?? 'Module'} unavailable`,
            'This module could not be initialized. Other Shadow Panel modules remain available.',
            textButton('Retry', () => {
                this._extension._queueRebuild();
                this.menu.close();
            })
        ));
        return {
            id,
            actor,
            activate() {},
            onPopupOpened() {},
            onPopupClosed() {},
            destroy() {
                actor.destroy();
            },
        };
    }

    _select(id) {
        if (!this._pages.has(id))
            return;
        const previousId = this._activeId;
        const animate = previousId && previousId !== id &&
            this._settings.get_boolean('animations');
        this._activeId = id;
        if (this._popupOpen && previousId && previousId !== id)
            this._pages.get(previousId)?.onPopupClosed();
        for (const [pageId, page] of this._pages) {
            page.actor.remove_all_transitions();
            if (pageId === id) {
                page.actor.visible = true;
                page.actor.opacity = animate ? 0 : 255;
                page.activate();
                if (animate) {
                    page.actor.ease({
                        opacity: 255,
                        duration: 110,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                }
            } else {
                page.actor.visible = false;
                page.actor.opacity = 255;
            }
        }
        this._tabs.setActive(id);
        if (this._popupOpen && previousId !== id)
            this._pages.get(id)?.onPopupOpened();
        if (this._settings.get_boolean('remember-last-tab'))
            this._settings.set_string('last-selected-tab', id);
    }

    _updateCodexSummary(state) {
        const percent = codexRemainingSummary(state);
        const source = state?.fiveHour ? 'five-hour' : 'weekly';
        this._setSummary('codex', percent === null ? null : `${percent}%`,
            percent === null
                ? 'Codex remaining usage unavailable'
                : `Codex ${source}: ${percent}% remaining`);
    }

    _updateWeatherSummary(state) {
        const temperature = weatherSummaryTemperature(state);
        const unit = state?.unit === 'fahrenheit' ? 'Fahrenheit' : 'Celsius';
        if (state?.current?.condition?.icon)
            this._summaryActors.get('weather').icon.icon_name = state.current.condition.icon;
        this._setSummary('weather', temperature === null ? null : `${temperature}°`,
            temperature === null ? 'Weather unavailable' : `Temperature ${temperature} degrees ${unit}`);
    }

    _updateNotesSummary(status) {
        const count = status?.status === 'loading' ? null : notesSummaryCount(this._notes);
        const vault = this._obsidianState?.status === 'ready'
            ? ` · Obsidian ${this._obsidianState.vaultName} linked`
            : '';
        this._setSummary('notes', count === null ? null : `${count}`,
            count === null
                ? 'Quick Notes loading'
                : `${count} local ${count === 1 ? 'note' : 'notes'}${vault}`);
    }

    _setSummary(id, value, accessibleName) {
        const summary = this._summaryActors.get(id);
        if (!summary)
            return;
        summary.value = value;
        summary.accessibleName = accessibleName;
        this._syncIndicator();
    }

    _syncIndicator() {
        const enabled = {
            codex: this._settings.get_boolean('show-codex-summary'),
            weather: this._settings.get_boolean('show-weather-summary'),
            notes: this._settings.get_boolean('show-notes-summary'),
        };
        const showText = this._settings.get_boolean('show-top-bar-text');
        const candidates = [...this._summaryActors].filter(([id, summary]) =>
            enabled[id] && (summary.value !== null || id === 'codex' || id === 'notes' || !showText));
        const monitorWidth = Main.layoutManager.primaryMonitor?.width ?? global.stage.width;
        const maximumItems = showText
            ? monitorWidth < 700 ? 1 : monitorWidth < 900 ? 2 : 3
            : 3;
        const visibleIds = new Set(candidates.slice(0, maximumItems).map(([id]) => id));
        const descriptions = [];
        let visibleCount = 0;
        for (const [id, summary] of this._summaryActors) {
            const visible = visibleIds.has(id);
            summary.item.visible = visible;
            summary.label.visible = visible && showText && summary.value !== null;
            if (summary.value !== null)
                summary.label.text = summary.value;
            summary.item.accessible_name = summary.accessibleName;
            if (visible) {
                visibleCount++;
                descriptions.push(summary.accessibleName);
            }
        }
        this._fallbackIcon.visible = visibleCount === 0;
        this.accessible_name = descriptions.length ? descriptions.join(', ') : 'Shadow Panel';
    }

    _onPopupOpened() {
        this._popupOpen = true;
        const page = this._pages.get(this._activeId);
        if (!page)
            return;
        try {
            page.onPopupOpened();
        } catch (error) {
            this._logger.warn(`Could not refresh ${MODULE_META[page.id]?.name ?? page.id}`, error);
        }
    }

    _onPopupClosed() {
        this._popupOpen = false;
        const page = this._pages.get(this._activeId);
        if (page) {
            try {
                page.onPopupClosed();
            } catch (error) {
                this._logger.warn(`Could not suspend ${MODULE_META[page.id]?.name ?? page.id}`, error);
            }
        }
        this._extension._flushPendingRebuild();
    }

    getTransientState() {
        return {
            notes: this._pages.get('notes')?.getTransientState?.() ??
                this._transientState.notes ?? null,
        };
    }

    destroy() {
        for (const unsubscribe of this._subscriptions.splice(0))
            unsubscribe();
        for (const page of this._pages.values())
            page.destroy();
        this._pages.clear();
        this._tabs?.destroy();
        super.destroy();
    }
});

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {formatCountdown, formatResetDate} from '../lib/format.js';
import {ACCENTS, MODULE_IDS, MODULE_META} from '../lib/constants.js';
import {chooseInitialModule} from '../lib/moduleConfig.js';
import {codexRemainingSummary, weatherSummaryTemperature} from '../lib/summary.js';
import {PAGE_FACTORIES} from '../modules/index.js';
import {
    animationsEnabled,
    attachTooltip,
    iconButton,
    moduleIcon,
    pageTitle,
    stateMessage,
    textButton,
} from './components.js';
import {TabStrip} from './tabs.js';

function effectiveTheme(settings) {
    const configured = settings.get_string('theme');
    if (configured === 'dark' || configured === 'light')
        return configured;
    return St.Settings.get().color_scheme === St.SystemColorScheme.PREFER_LIGHT
        ? 'light'
        : 'dark';
}

function resetCountdown(window) {
    if (!Number.isFinite(window?.resetsAt))
        return null;
    const formatted = formatCountdown(window.resetsAt);
    return formatted === 'Reset time unavailable' ? null : formatted.replace(/^Resets in /, '');
}

export const ShadowIndicator = GObject.registerClass(
class ShadowIndicator extends PanelMenu.Button {
    _init(extension, settings, logger) {
        super._init(0.5, 'Shadowokx Panel', false);
        this._extension = extension;
        this._settings = settings;
        this._logger = logger;
        this._pages = new Map();
        this._subscriptions = [];
        this._activeId = null;
        this._popupOpen = false;
        this._destroyed = false;
        this._codexState = null;
        this._weatherState = null;
        this._notificationSource = null;

        this._buildIndicator();
        this._buildDashboard();
        this._createPages();

        if (settings.get_string('theme') === 'auto') {
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
        this._indicatorBox = new St.BoxLayout({
            style_class: 'shadow-panel-indicator',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._fallbackIcon = moduleIcon(
            this._extension,
            'codex',
            15,
            'shadow-panel-fallback-icon'
        );
        this._indicatorBox.add_child(this._fallbackIcon);
        this._codexSummary = this._summaryItem('codex', 'Codex usage');
        this._weatherSummary = this._summaryItem('weather', 'Weather');
        this._indicatorBox.add_child(this._codexSummary.item);
        this._indicatorBox.add_child(this._weatherSummary.item);
        this.add_child(this._indicatorBox);
        attachTooltip(this, () => this._indicatorTooltipText());

        const monitorsChangedId = Main.layoutManager.connect('monitors-changed', () =>
            this._syncIndicator());
        this._subscriptions.push(() => Main.layoutManager.disconnect(monitorsChangedId));
        this._syncIndicator();
    }

    _summaryItem(id, accessibleName) {
        const item = new St.BoxLayout({
            style_class: `shadow-panel-summary shadow-panel-summary-${id}`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const icon = moduleIcon(this._extension, id, 15, 'shadow-panel-summary-icon');
        const label = new St.Label({
            style_class: 'shadow-panel-summary-value',
            y_align: Clutter.ActorAlign.CENTER,
        });
        item.add_child(icon);
        item.add_child(label);
        item.accessible_name = accessibleName;
        return {item, icon, label};
    }

    _buildDashboard() {
        const density = this._settings.get_string('density');
        const background = this._settings.get_string('background-theme');
        const panelWidth = this._settings.get_string('panel-width');
        const accentName = this._settings.get_string('accent-color');
        const accentClass = Object.hasOwn(ACCENTS, accentName) ? accentName : 'custom';
        this._root = new St.BoxLayout({
            vertical: true,
            style_class: `shadow-dashboard shadow-${density} ` +
                `shadow-theme-${effectiveTheme(this._settings)} ` +
                `shadow-bg-${background} shadow-accent-${accentClass} ` +
                `shadow-width-${panelWidth}`,
        });

        const header = new St.BoxLayout({style_class: 'shadow-header', x_expand: true});
        header.add_child(new St.Label({
            text: 'Shadowokx Panel',
            style_class: 'shadow-product-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        header.add_child(iconButton('emblem-system-symbolic', 'Open settings', () => {
            this.menu.close();
            this._extension.openPreferences();
        }, 'shadow-icon-button shadow-settings-button'));
        this._root.add_child(header);

        this._tabs = new TabStrip(
            this._extension,
            this._settings,
            MODULE_IDS,
            id => this._select(id)
        );
        this._root.add_child(this._tabs.actor);

        this._pageStack = new St.Widget({
            style_class: 'shadow-page-stack',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            width: {narrow: 350, standard: 386, wide: 420}[panelWidth] ?? 386,
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

    _createPages() {
        const services = this._extension.getRuntimeServices();
        const context = {
            extension: this._extension,
            settings: this._settings,
            scheduler: services.scheduler,
            logger: this._logger,
            notify: (title, message, options = {}) =>
                this._notify(title, message, options),
            pageWidth: this._pageStack.width,
            getMaxScrollHeight: () => this._maxScrollHeight(),
            codexProvider: services.codexProvider,
            weatherProvider: services.weatherProvider,
        };

        this._subscriptions.push(services.codexProvider.subscribe(state => {
            if (this._destroyed)
                return;
            this._codexState = state;
            this._syncIndicator();
        }));
        this._subscriptions.push(services.weatherProvider.subscribe(state => {
            if (this._destroyed)
                return;
            this._weatherState = state;
            this._syncIndicator();
        }));

        for (const id of MODULE_IDS) {
            try {
                const page = PAGE_FACTORIES[id](context);
                page.actor.width = this._pageStack.width;
                page.actor.hide();
                this._pageStack.add_child(page.actor);
                this._pages.set(id, page);
            } catch (error) {
                this._logger.warn(`Could not create ${id} page`, error);
                const page = this._moduleErrorPage(id);
                page.actor.width = this._pageStack.width;
                page.actor.hide();
                this._pageStack.add_child(page.actor);
                this._pages.set(id, page);
            }
        }

        const initial = chooseInitialModule(
            [...this._pages.keys()],
            this._settings.get_boolean('remember-last-tab'),
            this._settings.get_string('last-selected-tab'),
            this._settings.get_string('default-tab')
        );
        if (initial)
            this._select(initial);
    }

    _maxScrollHeight() {
        const monitor = Main.layoutManager.findMonitorForActor(this) ??
            Main.layoutManager.primaryMonitor;
        const height = monitor?.height ?? global.stage.height;
        const reserve = this._settings.get_string('density') === 'compact' ? 168 : 184;
        return Math.max(220, height - Main.panel.height - reserve);
    }

    _moduleErrorPage(id) {
        const actor = new St.BoxLayout({
            vertical: true,
            style_class: `shadow-page shadow-page-${id}`,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_expand: true,
        });
        actor.add_child(pageTitle(MODULE_META[id].name));
        actor.add_child(stateMessage(
            'dialog-warning-symbolic',
            `${MODULE_META[id].name} unavailable`,
            'This page could not be initialized. The other page remains available.',
            textButton('Retry', () => {
                this.menu.close();
                this._extension._queueRebuild();
            })
        ));
        return {
            id,
            actor,
            activate() {},
            onPopupOpened() {},
            onPopupClosed() {},
            destroy() { actor.destroy(); },
        };
    }

    _select(id) {
        if (!this._pages.has(id))
            return;
        const previousId = this._activeId;
        const animate = Boolean(previousId && previousId !== id &&
            animationsEnabled(this._settings));
        this._activeId = id;
        if (this._popupOpen && previousId && previousId !== id)
            this._pages.get(previousId)?.onPopupClosed();
        for (const [pageId, page] of this._pages) {
            page.actor.remove_all_transitions();
            if (pageId === id) {
                page.actor.show();
                page.actor.opacity = animate ? 0 : 255;
                page.activate();
                if (animate) {
                    page.actor.ease({
                        opacity: 255,
                        duration: 140,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                }
            } else {
                page.actor.hide();
                page.actor.opacity = 255;
            }
        }
        this._tabs.setActive(id);
        if (this._popupOpen && previousId !== id)
            this._pages.get(id)?.onPopupOpened();
        if (this._settings.get_boolean('remember-last-tab'))
            this._settings.set_string('last-selected-tab', id);
    }

    _syncIndicator() {
        if (this._destroyed || !this._codexSummary || !this._weatherSummary)
            return;
        const monitorWidth = Main.layoutManager.primaryMonitor?.width ?? global.stage.width;
        const constrained = monitorWidth < 900;
        const singleItem = monitorWidth < 650;

        const codexWindow = this._codexState?.weekly ?? this._codexState?.fiveHour;
        const codexPercent = codexRemainingSummary(this._codexState);
        const codexParts = [];
        if (this._settings.get_boolean('show-codex-remaining') && codexPercent !== null)
            codexParts.push(`${codexPercent}%`);
        if (!constrained && this._settings.get_boolean('show-codex-reset-countdown')) {
            const countdown = resetCountdown(codexWindow);
            if (countdown)
                codexParts.push(countdown);
        }
        const codexIcon = this._settings.get_boolean('show-codex-icon');
        this._codexSummary.icon.visible = codexIcon;
        this._codexSummary.label.text = codexParts.join('  ');
        this._codexSummary.label.visible = codexParts.length > 0;
        this._codexSummary.item.visible = codexIcon || codexParts.length > 0;
        this._codexSummary.item.accessible_name = codexPercent === null
            ? 'Codex remaining capacity unavailable'
            : `Codex ${codexPercent}% remaining`;

        const temperature = weatherSummaryTemperature(this._weatherState);
        const weatherParts = [];
        if (this._settings.get_boolean('show-weather-temperature') && temperature !== null)
            weatherParts.push(`${temperature}°`);
        if (!constrained && this._settings.get_boolean('show-weather-condition') &&
            this._weatherState?.current?.condition?.label) {
            weatherParts.push(this._weatherState.current.condition.label);
        }
        const weatherIcon = this._settings.get_boolean('show-weather-icon');
        this._weatherSummary.icon.visible = weatherIcon;
        if (this._weatherState?.current?.condition?.icon)
            this._weatherSummary.icon.icon_name = this._weatherState.current.condition.icon;
        this._weatherSummary.label.text = weatherParts.join('  ');
        this._weatherSummary.label.visible = weatherParts.length > 0;
        const weatherConfigured = weatherIcon || weatherParts.length > 0;
        this._weatherSummary.item.visible = weatherConfigured &&
            !(singleItem && this._codexSummary.item.visible);
        this._weatherSummary.item.accessible_name = temperature === null
            ? 'Weather unavailable'
            : `Weather ${temperature} degrees, ${this._weatherState.current.condition.label}`;

        const summariesVisible = this._codexSummary.item.visible || this._weatherSummary.item.visible;
        this._fallbackIcon.visible = !summariesVisible;
        const descriptions = [this._codexSummary, this._weatherSummary]
            .filter(summary => summary.item.visible)
            .map(summary => summary.item.accessible_name);
        this.accessible_name = descriptions.join(', ') || 'Shadowokx Panel';
    }

    _indicatorTooltipText() {
        const lines = [];
        const codexPercent = codexRemainingSummary(this._codexState);
        const codexWindow = this._codexState?.weekly ?? this._codexState?.fiveHour;
        if (codexPercent !== null) {
            lines.push(`Codex · ${codexPercent}% remaining`);
            if (Number.isFinite(codexWindow?.resetsAt))
                lines.push(`Resets ${formatResetDate(codexWindow.resetsAt)}`);
        }
        const temperature = weatherSummaryTemperature(this._weatherState);
        if (temperature !== null) {
            const condition = this._weatherState.current.condition?.label;
            lines.push(`${temperature}°${condition ? ` · ${condition}` : ''}`);
            if (Number.isFinite(this._weatherState.current.feelsLike))
                lines.push(`Feels like ${Math.round(this._weatherState.current.feelsLike)}°`);
        }
        return lines.join('\n') || 'Shadowokx Panel';
    }

    _onPopupOpened() {
        this._popupOpen = true;
        try {
            this._pages.get(this._activeId)?.onPopupOpened();
        } catch (error) {
            this._logger.warn(`Could not refresh ${this._activeId}`, error);
        }
    }

    _onPopupClosed() {
        this._popupOpen = false;
        try {
            this._pages.get(this._activeId)?.onPopupClosed();
        } catch (error) {
            this._logger.warn(`Could not suspend ${this._activeId}`, error);
        }
        this._extension._flushPendingRebuild();
    }

    _notify(title, body, options = {}) {
        if (this._destroyed)
            return;
        if (!this._notificationSource) {
            this._notificationSource = new MessageTray.Source({
                title: 'Shadowokx Panel',
                'icon-name': 'dialog-information-symbolic',
            });
            this._notificationSource.connect('destroy', () => {
                this._notificationSource = null;
            });
            Main.messageTray.add(this._notificationSource);
        }
        const notification = new MessageTray.Notification({
            source: this._notificationSource,
            title,
            body,
            'is-transient': true,
        });
        if (options.actionLabel && typeof options.action === 'function')
            notification.addAction(options.actionLabel, options.action);
        this._notificationSource.addNotification(notification);
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        for (const unsubscribe of this._subscriptions.splice(0))
            unsubscribe();
        for (const page of this._pages.values())
            page.destroy();
        this._pages.clear();
        this._tabs?.destroy();
        this._tabs = null;
        this._codexSummary = null;
        this._weatherSummary = null;
        this._fallbackIcon = null;
        this._notificationSource?.destroy();
        this._notificationSource = null;
        super.destroy();
    }
});

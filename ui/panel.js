import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {formatCountdown, formatResetDate} from '../lib/format.js';
import {ACCENTS, MODULE_IDS, MODULE_META} from '../lib/constants.js';
import {chooseInitialModule} from '../lib/moduleConfig.js';
import {
    codexRemainingSummary,
    codexUsagePace,
    weatherSummaryTemperature,
} from '../lib/summary.js';
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
        this._lastUsageState = null;
        this._mounted = false;
        this._mountSignalId = 0;
        this._moduleIds = MODULE_IDS.filter(id =>
            id !== 'weather' || settings.get_boolean('show-weather-panel'));

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
        this._codexPaceIcon = new St.Icon({
            icon_size: 12,
            style_class: 'shadow-panel-usage-state',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._usageHighIcon = Gio.icon_new_for_string(GLib.build_filenamev([
            this._extension.path,
            'icons',
            'usage-high-symbolic.svg',
        ]));
        this._codexSummary.item.add_child(this._codexPaceIcon);
        this._weatherSummary = this._summaryItem('weather', 'Weather');
        this._indicatorBox.add_child(this._codexSummary.item);
        this._indicatorBox.add_child(this._weatherSummary.item);
        this.add_child(this._indicatorBox);
        attachTooltip(this, () => this._indicatorTooltipText());

        const monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            this._syncIndicator();
            this._pages.get(this._activeId)?.fit?.();
        });
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

        if (this._moduleIds.length > 1) {
            this._tabs = new TabStrip(
                this._extension,
                this._settings,
                this._moduleIds,
                id => this._select(id)
            );
            this._root.add_child(this._tabs.actor);
        } else {
            this._tabs = null;
        }

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
            fitPageScroll: (scroll, pageActor) => this._fitPageScroll(scroll, pageActor),
            codexProvider: services.codexProvider,
            weatherProvider: services.weatherProvider,
        };

        this._subscriptions.push(services.codexProvider.subscribe(state => {
            if (this._destroyed)
                return;
            this._codexState = state;
            this._syncIndicator();
        }));
        if (services.weatherProvider) {
            this._subscriptions.push(services.weatherProvider.subscribe(state => {
                if (this._destroyed)
                    return;
                this._weatherState = state;
                this._syncIndicator();
            }));
        }

        for (const id of this._moduleIds) {
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

    _activeWorkArea() {
        const monitor = Main.layoutManager.findMonitorForActor(this) ??
            Main.layoutManager.primaryMonitor;
        if (Number.isInteger(monitor?.index))
            return Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        return monitor ?? {x: 0, y: 0, width: global.stage.width, height: global.stage.height};
    }

    _fitPageScroll(scroll, pageActor) {
        if (this._destroyed)
            return;
        const natural = scroll?._shadowNaturalHeight;
        if (!scroll || !Number.isFinite(natural))
            return;

        scroll.height = natural;
        scroll.vscrollbar_policy = St.PolicyType.NEVER;
        if (pageActor && (!pageActor.visible || pageActor !== this._pages.get(this._activeId)?.actor))
            return;

        // The work area already excludes the GNOME panel and other struts.
        // Measure all dashboard chrome with the scroll view at natural height,
        // then subtract only the overflow plus a small edge safety margin.
        const workArea = this._activeWorkArea();
        const safeEdgeMargin = 12;
        const maximumRootHeight = Math.max(1, workArea.height - safeEdgeMargin);
        const [, desiredRootHeight] = this._root.get_preferred_height(-1);
        const nonScrollHeight = Math.max(0, Math.ceil(desiredRootHeight) - natural);
        const maximumViewport = Math.max(1, maximumRootHeight - nonScrollHeight);
        const fittedHeight = Math.min(natural, maximumViewport);
        scroll.height = fittedHeight;
        scroll.vscrollbar_policy = fittedHeight < natural
            ? St.PolicyType.EXTERNAL
            : St.PolicyType.NEVER;
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
            'This page could not be initialized. Shadowokx Panel remains available.',
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
        if (this._destroyed || !this._pages.has(id))
            return;
        const previousId = this._activeId;
        const animate = Boolean(previousId && previousId !== id &&
            animationsEnabled(this._settings));
        this._activeId = id;
        if (this._popupOpen && previousId && previousId !== id)
            this._pages.get(previousId)?.onPopupClosed();
        let selectedPage = null;
        for (const [pageId, page] of this._pages) {
            page.actor.remove_all_transitions();
            if (pageId === id) {
                page.actor.show();
                page.actor.opacity = animate ? 0 : 255;
                selectedPage = page;
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
        this._tabs?.setActive(id);
        if (this._popupOpen && previousId !== id)
            selectedPage?.onPopupOpened();
        selectedPage?.activate();
        if (this._settings.get_boolean('remember-last-tab'))
            this._settings.set_string('last-selected-tab', id);
    }

    _syncIndicator() {
        if (this._destroyed || !this._mounted ||
            !this._codexSummary || !this._weatherSummary)
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
        this._syncUsageState();

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
        const weatherConfigured = this._settings.get_boolean('show-weather-top-bar') &&
            (weatherIcon || weatherParts.length > 0);
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

    _syncUsageState() {
        const enabled = this._settings.get_boolean('show-codex-usage-state') &&
            this._settings.get_boolean('show-codex-remaining') &&
            codexRemainingSummary(this._codexState) !== null;
        const state = enabled ? codexUsagePace(this._codexState) : null;
        this._codexPaceIcon.visible = Boolean(state);
        if (!state) {
            this._lastUsageState = null;
            return;
        }

        this._codexPaceIcon.gicon = state.key === 'high'
            ? this._usageHighIcon
            : Gio.ThemedIcon.new(state.iconName);
        for (const key of ['high', 'normal', 'low'])
            this._codexPaceIcon.remove_style_class_name(`shadow-usage-state-${key}`);
        this._codexPaceIcon.add_style_class_name(`shadow-usage-state-${state.key}`);
        this._codexPaceIcon.accessible_name = state.label;
        if (this._lastUsageState && this._lastUsageState !== state.key &&
            this._codexPaceIcon.mapped && animationsEnabled(this._settings)) {
            this._codexPaceIcon.remove_all_transitions();
            this._codexPaceIcon.opacity = 150;
            this._codexPaceIcon.ease({
                opacity: 255,
                duration: 140,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this._codexPaceIcon.opacity = 255;
        }
        this._lastUsageState = state.key;
        this._codexSummary.item.accessible_name += `, ${state.label.toLowerCase()}`;
    }

    syncIndicatorSettings() {
        this._syncIndicator();
    }

    completeMount() {
        if (this._destroyed)
            return;
        if (this.mapped) {
            this._mounted = true;
            this._syncIndicator();
            return;
        }
        if (this._mountSignalId)
            return;
        this._mountSignalId = this.connect('notify::mapped', () => {
            if (!this.mapped || this._destroyed)
                return;
            this.disconnect(this._mountSignalId);
            this._mountSignalId = 0;
            this._mounted = true;
            this._syncIndicator();
        });
    }

    _indicatorTooltipText() {
        const lines = [];
        const codexPercent = codexRemainingSummary(this._codexState);
        const usageState = this._settings.get_boolean('show-codex-usage-state')
            ? codexUsagePace(this._codexState)
            : null;
        const codexWindow = this._codexState?.weekly ?? this._codexState?.fiveHour;
        if (codexPercent !== null) {
            lines.push(`Codex · ${codexPercent}% remaining`);
            if (Number.isFinite(codexWindow?.resetsAt))
                lines.push(`Resets ${formatResetDate(codexWindow.resetsAt)}`);
            if (usageState)
                lines.push(usageState.label);
        }
        const temperature = weatherSummaryTemperature(this._weatherState);
        if (this._settings.get_boolean('show-weather-top-bar') && temperature !== null) {
            const condition = this._weatherState.current.condition?.label;
            lines.push(`${temperature}°${condition ? ` · ${condition}` : ''}`);
            if (Number.isFinite(this._weatherState.current.feelsLike))
                lines.push(`Feels like ${Math.round(this._weatherState.current.feelsLike)}°`);
        }
        return lines.join('\n') || 'Shadowokx Panel';
    }

    _onPopupOpened() {
        if (this._destroyed)
            return;
        this._popupOpen = true;
        try {
            this._pages.get(this._activeId)?.onPopupOpened();
        } catch (error) {
            this._logger.warn(`Could not refresh ${this._activeId}`, error);
        }
    }

    _onPopupClosed() {
        if (this._destroyed)
            return;
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
        this._mounted = false;
        if (this._mountSignalId) {
            this.disconnect(this._mountSignalId);
            this._mountSignalId = 0;
        }
        for (const unsubscribe of this._subscriptions.splice(0))
            unsubscribe();
        for (const page of this._pages.values())
            page.destroy();
        this._pages.clear();
        this._tabs?.destroy();
        this._tabs = null;
        this._codexSummary = null;
        this._weatherSummary = null;
        this._codexPaceIcon = null;
        this._usageHighIcon = null;
        this._fallbackIcon = null;
        this._notificationSource?.destroy();
        this._notificationSource = null;
        super.destroy();
    }
});

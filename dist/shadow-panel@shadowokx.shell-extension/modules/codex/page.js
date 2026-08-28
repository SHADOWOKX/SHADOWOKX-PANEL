import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {formatClock, formatCountdown, formatResetDate} from '../../lib/format.js';
import {launchUri} from '../../services/launcher.js';
import {BasePage} from '../basePage.js';
import {exportCodexSummaryImage} from './shareImage.js';
import {
    ProgressMeter,
    clearChildren,
    iconButton,
    moduleIconButton,
    pageTitle,
    resolveAccent,
    scrollContainer,
    stateMessage,
    textButton,
} from '../../ui/components.js';

export class CodexPage extends BasePage {
    constructor(context) {
        super(context, 'codex');
        this._provider = context.codexProvider;
        this._shareNotice = null;
        this._sharing = false;
        this._destroyed = false;
        this._popupOpen = false;
        this._lastWeeklyPercent = null;
        this.track(this._provider.subscribe(() => this._render()));
    }

    onPopupOpened() {
        this._popupOpen = true;
        this._lastWeeklyPercent = null;
        this._render();
        this.context.scheduler.every('codex-countdown', 60, () => this._render());
        if (this.context.settings.get_boolean('refresh-on-open') && this._provider.isStale())
            this._provider.refresh(false);
    }

    onPopupClosed() {
        this._popupOpen = false;
        this.context.scheduler.cancel('codex-countdown');
    }

    _render() {
        if (!this.actor)
            return;
        const state = this._provider.getState();
        clearChildren(this.actor);

        const actions = new St.BoxLayout({style_class: 'shadow-title-actions'});
        const open = moduleIconButton(
            this.context.extension,
            'codex',
            'Open Codex application',
            () => this._openCodex(),
            'shadow-icon-button shadow-codex-open-button'
        );
        open.set_style('color: ' + resolveAccent(this.context.settings) + ';');
        actions.add_child(open);
        const share = iconButton(
            this._sharing ? 'process-working-symbolic' : 'document-send-symbolic',
            this._sharing ? 'Creating Codex summary image' : 'Export Codex summary image',
            () => this._share(state)
        );
        share.reactive = !this._sharing && Boolean(state.weekly || state.fiveHour);
        share.can_focus = share.reactive;
        if (!share.reactive)
            share.opacity = 130;
        actions.add_child(share);
        const refresh = iconButton('view-refresh-symbolic', 'Refresh Codex usage', () =>
            this._provider.refresh(true), 'shadow-icon-button shadow-accent-button');
        refresh.set_style('color: ' + resolveAccent(this.context.settings) + ';');
        actions.add_child(refresh);
        this.actor.add_child(pageTitle('Codex', actions));

        if (state.status === 'loading' && !state.lastSuccessfulRefresh) {
            this.actor.add_child(stateMessage(
                'content-loading-symbolic',
                'Loading Codex usage',
                'Reading limits from the local Codex app-server…'
            ));
            return;
        }

        if (state.status === 'error' && !state.lastSuccessfulRefresh) {
            this.actor.add_child(stateMessage(
                'dialog-warning-symbolic',
                'Codex usage unavailable',
                state.error ?? 'Shadowokx Panel could not read Codex usage.',
                textButton('Retry', () => this._provider.refresh(true))
            ));
            return;
        }

        const content = new St.BoxLayout({vertical: true, style_class: 'shadow-codex-content'});
        const identity = [state.accountName, state.planLabel].filter(Boolean).join(' · ');
        if (identity) {
            const identityLabel = new St.Label({
                text: identity,
                style_class: 'shadow-codex-context shadow-muted',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
            });
            identityLabel.clutter_text.set_single_line_mode(true);
            identityLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            content.add_child(identityLabel);
        }
        if (this._shareNotice)
            content.add_child(this._notice());
        else if (state.status === 'stale')
            content.add_child(this._staleBanner());

        content.add_child(this._weeklyHero(state.weekly));
        content.add_child(this._fiveHourCard(state.fiveHour));
        const facts = this._facts(state);
        if (facts)
            content.add_child(facts);
        content.add_child(this._footer(state));
        this.actor.add_child(scrollContainer(content, 'shadow-codex-scroll'));
    }

    _notice() {
        const row = new St.BoxLayout({
            style_class: this._shareNotice.error ? 'shadow-inline-error' : 'shadow-inline-success',
            x_expand: true,
        });
        row.add_child(new St.Label({
            text: this._shareNotice.text,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        if (this._shareNotice.directoryPath) {
            row.add_child(textButton('Open folder', () => {
                const uri = Gio.File.new_for_path(this._shareNotice.directoryPath).get_uri();
                launchUri(uri, this.context.logger).catch(() => {});
            }, 'shadow-text-button shadow-secondary-button'));
        }
        return row;
    }

    _staleBanner() {
        const stale = new St.BoxLayout({style_class: 'shadow-status-banner', x_expand: true});
        stale.add_child(new St.Icon({icon_name: 'dialog-warning-symbolic', icon_size: 14}));
        stale.add_child(new St.Label({
            text: 'Showing the last successful update',
            style_class: 'shadow-status-banner-label',
            x_expand: true,
        }));
        return stale;
    }

    _weeklyHero(window) {
        const card = new St.BoxLayout({vertical: true, style_class: 'shadow-weekly-hero'});
        const animateProgress = this._popupOpen && Boolean(window) &&
            this._lastWeeklyPercent !== window.remainingPercent;
        this._lastWeeklyPercent = window?.remainingPercent ?? null;
        const heading = new St.BoxLayout({x_expand: true});
        heading.add_child(new St.Label({
            text: 'WEEKLY CAPACITY',
            style_class: 'shadow-hero-kicker',
            x_expand: true,
        }));
        heading.add_child(new St.Label({
            text: window ? `${window.usedPercent}% used` : 'Unavailable',
            style_class: 'shadow-usage-remaining',
        }));
        card.add_child(heading);

        if (!window) {
            card.add_child(new St.Label({
                text: 'Weekly limit not reported',
                style_class: 'shadow-weekly-unavailable',
                x_align: Clutter.ActorAlign.START,
            }));
            card.add_child(new St.Label({
                text: 'Codex did not include a weekly usage window in this update.',
                style_class: 'shadow-muted',
                x_align: Clutter.ActorAlign.START,
            }));
            return card;
        }

        const value = new St.BoxLayout({style_class: 'shadow-weekly-value-row'});
        value.add_child(new St.Label({
            text: `${window.remainingPercent}%`,
            style_class: 'shadow-weekly-value',
        }));
        value.add_child(new St.Label({
            text: 'remaining',
            style_class: 'shadow-weekly-unit',
            y_align: Clutter.ActorAlign.END,
        }));
        card.add_child(value);
        const width = this.context.settings.get_string('density') === 'compact' ? 270 : 304;
        card.add_child(new ProgressMeter(
            window.remainingPercent,
            resolveAccent(this.context.settings),
            width,
            'remaining',
            animateProgress && this.context.settings.get_boolean('animations')
        ).actor);
        const reset = new St.BoxLayout({style_class: 'shadow-weekly-reset', x_expand: true});
        reset.add_child(new St.Label({
            text: formatCountdown(window.resetsAt),
            style_class: 'shadow-usage-countdown',
            x_expand: true,
        }));
        reset.add_child(new St.Label({
            text: formatResetDate(window.resetsAt),
            style_class: 'shadow-reset-date',
        }));
        card.add_child(reset);
        return card;
    }

    _fiveHourCard(window) {
        const card = new St.BoxLayout({style_class: 'shadow-five-hour-card', x_expand: true});
        const copy = new St.BoxLayout({vertical: true, x_expand: true});
        copy.add_child(new St.Label({text: '5-hour window', style_class: 'shadow-card-title'}));
        copy.add_child(new St.Label({
            text: window ? formatCountdown(window.resetsAt) : 'Not reported by this Codex session',
            style_class: 'shadow-muted',
        }));
        card.add_child(copy);
        card.add_child(new St.Label({
            text: window ? `${window.remainingPercent}% left` : 'Unavailable',
            style_class: window ? 'shadow-five-hour-value' : 'shadow-usage-unavailable-mark',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        return card;
    }

    _facts(state) {
        const items = [];
        if (state.resetCreditsAvailable > 0) {
            items.push({
                label: 'Reset credits',
                value: String(state.resetCreditsAvailable),
            });
        }
        if (state.clientVersion)
            items.push({label: 'Codex client', value: state.clientVersion});
        if (!items.length)
            return null;

        const row = new St.BoxLayout({style_class: 'shadow-codex-facts', x_expand: true});
        for (const item of items) {
            const fact = new St.BoxLayout({vertical: true, style_class: 'shadow-codex-fact', x_expand: true});
            fact.add_child(new St.Label({text: item.label, style_class: 'shadow-metric-label'}));
            fact.add_child(new St.Label({text: item.value, style_class: 'shadow-metric-value'}));
            row.add_child(fact);
        }
        return row;
    }

    _footer(state) {
        const footer = new St.BoxLayout({style_class: 'shadow-provider-footer', x_expand: true});
        const statusText = state.status === 'stale' || state.status === 'cached'
            ? 'Cached'
            : state.status === 'refreshing' ? 'Updating…' : 'Connected';
        footer.add_child(new St.Label({
            text: statusText,
            style_class: 'shadow-provider-status',
            x_expand: true,
        }));
        footer.add_child(new St.Label({
            text: 'Updated ' + formatClock(state.lastSuccessfulRefresh),
            style_class: 'shadow-muted',
        }));
        return footer;
    }

    _openCodex() {
        launchUri('codex://', this.context.logger).catch(() => {
            this._shareNotice = {error: true, text: 'Codex could not be opened.'};
            this._render();
        });
    }

    async _share(state) {
        if (this._sharing || (!state.weekly && !state.fiveHour))
            return;
        this._sharing = true;
        this._shareNotice = null;
        this._render();
        try {
            const configuredTheme = this.context.settings.get_string('theme');
            const interfaceTheme = configuredTheme === 'auto'
                ? St.Settings.get().color_scheme === St.SystemColorScheme.PREFER_LIGHT
                    ? 'light'
                    : 'dark'
                : configuredTheme;
            const result = await exportCodexSummaryImage(state, {
                accent: resolveAccent(this.context.settings),
                backgroundTheme: this.context.settings.get_string('background-theme'),
                interfaceTheme,
                customBackground: this.context.settings.get_string('custom-background'),
            });
            this._shareNotice = {
                error: false,
                text: `Saved ${result.fileName}`,
                directoryPath: result.directoryPath,
            };
        } catch (error) {
            this.context.logger?.debug('codex.share.failed', {code: error.code ?? 'image-export'});
            this._shareNotice = {
                error: true,
                text: 'The summary image could not be saved.',
            };
        } finally {
            this._sharing = false;
            if (!this._destroyed)
                this._render();
        }
    }

    destroy() {
        this._destroyed = true;
        this.context.scheduler.cancel('codex-countdown');
        super.destroy();
    }
}

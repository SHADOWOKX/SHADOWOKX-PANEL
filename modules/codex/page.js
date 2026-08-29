import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {formatClock, formatCountdown, formatResetDate} from '../../lib/format.js';
import {codexUsageStatus} from '../../lib/summary.js';
import {launchUri} from '../../services/launcher.js';
import {
    ProgressMeter,
    clearChildren,
    iconButton,
    moduleTextButton,
    moduleIcon,
    pageTitle,
    resolveAccent,
    scrollContainer,
    stateMessage,
    textButton,
} from '../../ui/components.js';
import {BasePage} from '../basePage.js';
import {exportCodexSummaryImage} from './shareImage.js';

export class CodexPage extends BasePage {
    constructor(context) {
        super(context, 'codex');
        this._provider = context.codexProvider;
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
        if (this._destroyed || this._pageDestroyed || !this.actor)
            return;
        const state = this._provider.getState();
        clearChildren(this.actor);
        this.actor.add_child(pageTitle(
            'Codex Usage',
            this._actions(state),
            moduleIcon(this.context.extension, 'codex', 19, 'shadow-page-brand-icon')
        ));

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
                state.error ?? 'No usage data has been reported yet.',
                textButton('Retry', () => this._provider.refresh(true))
            ));
            return;
        }

        const content = new St.BoxLayout({
            vertical: true,
            style_class: 'shadow-codex-content',
            x_expand: true,
        });
        let sectionCount = 0;
        if (this.context.settings.get_boolean('show-codex-weekly')) {
            content.add_child(this._weeklyHero(state.weekly));
            sectionCount++;
        }
        if (this.context.settings.get_boolean('show-codex-five-hour')) {
            content.add_child(this._fiveHourSection(state.fiveHour));
            sectionCount++;
        }
        if (sectionCount === 0) {
            content.add_child(new St.Label({
                text: 'Enable a usage window in Codex settings.',
                style_class: 'shadow-inline-empty shadow-muted',
            }));
        }

        content.add_child(this._tokenActivity(state.tokenUsage));

        const facts = this._facts(state);
        if (facts)
            content.add_child(facts);
        content.add_child(this._footer(state));
        this.actor.add_child(scrollContainer(content, 'shadow-codex-scroll'));
    }

    _actions(state) {
        const actions = new St.BoxLayout({style_class: 'shadow-title-actions'});
        actions.add_child(moduleTextButton(
            this.context.extension,
            'codex',
            'Open',
            'Open Codex application',
            () => this._openCodex(),
            'shadow-text-button shadow-action-button'
        ));
        actions.add_child(iconButton(
            'view-refresh-symbolic',
            'Refresh Codex usage',
            () => this._provider.refresh(true),
            'shadow-icon-button shadow-action-icon-button'
        ));
        const share = iconButton(
            this._sharing ? 'process-working-symbolic' : 'document-send-symbolic',
            this._sharing ? 'Creating usage image' : 'Create usage image',
            () => this._share(state),
            'shadow-icon-button shadow-action-icon-button'
        );
        share.reactive = !this._sharing && Boolean(state.weekly || state.fiveHour);
        share.can_focus = share.reactive;
        if (!share.reactive)
            share.opacity = 120;
        actions.add_child(share);
        return actions;
    }

    _weeklyHero(window) {
        const card = new St.BoxLayout({
            vertical: true,
            style_class: 'shadow-card shadow-weekly-hero',
            x_expand: true,
        });
        const heading = new St.BoxLayout({style_class: 'shadow-usage-heading', x_expand: true});
        heading.add_child(new St.Label({
            text: 'Weekly',
            style_class: 'shadow-section-label',
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        }));
        if (window) {
            const status = codexUsageStatus(window.remainingPercent);
            heading.add_child(new St.Label({
                text: `${status.emoji} ${status.label}`,
                style_class: 'shadow-usage-state',
            }));
        }
        card.add_child(heading);
        if (!window) {
            card.add_child(new St.Label({
                text: 'Unavailable',
                style_class: 'shadow-weekly-unavailable',
                x_align: Clutter.ActorAlign.START,
            }));
            card.add_child(new St.Label({
                text: 'Not reported by this Codex session.',
                style_class: 'shadow-muted',
                x_align: Clutter.ActorAlign.START,
            }));
            return card;
        }

        const value = new St.BoxLayout({style_class: 'shadow-weekly-value-row'});
        value.add_child(new St.Label({
            text: `${window.remainingPercent}%`,
            style_class: 'shadow-weekly-value',
            style: `color: ${resolveAccent(this.context.settings)};`,
        }));
        value.add_child(new St.Label({
            text: 'remaining',
            style_class: 'shadow-weekly-unit',
            y_align: Clutter.ActorAlign.END,
        }));
        card.add_child(value);

        const width = this.context.settings.get_string('density') === 'compact' ? 286 : 320;
        const animate = this._popupOpen && this._lastWeeklyPercent !== null &&
            this._lastWeeklyPercent !== window.remainingPercent &&
            this.context.settings.get_boolean('animations');
        this._lastWeeklyPercent = window.remainingPercent;
        card.add_child(new ProgressMeter(
            window.remainingPercent,
            resolveAccent(this.context.settings),
            width,
            'remaining',
            animate
        ).actor);

        if (this.context.settings.get_boolean('show-codex-reset-time')) {
            const reset = new St.BoxLayout({style_class: 'shadow-weekly-reset', x_expand: true});
            reset.add_child(new St.Label({
                text: formatCountdown(window.resetsAt),
                style_class: 'shadow-reset-countdown',
                x_expand: true,
            }));
            reset.add_child(new St.Label({
                text: formatResetDate(window.resetsAt),
                style_class: 'shadow-muted',
            }));
            card.add_child(reset);
        }
        return card;
    }

    _fiveHourSection(window) {
        const section = new St.BoxLayout({
            style_class: 'shadow-five-hour-section',
            x_expand: true,
        });
        const copy = new St.BoxLayout({vertical: true, x_expand: true});
        copy.add_child(new St.Label({
            text: '5-Hour Window',
            style_class: 'shadow-card-title',
            x_align: Clutter.ActorAlign.START,
        }));
        if (!window) {
            copy.add_child(new St.Label({
                text: 'Not reported by this Codex session.',
                style_class: 'shadow-muted',
                x_align: Clutter.ActorAlign.START,
            }));
            section.add_child(copy);
            section.add_child(new St.Label({
                text: 'Unavailable',
                style_class: 'shadow-five-hour-unavailable',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            return section;
        }

        if (this.context.settings.get_boolean('show-codex-reset-time')) {
            copy.add_child(new St.Label({
                text: formatCountdown(window.resetsAt),
                style_class: 'shadow-muted',
                x_align: Clutter.ActorAlign.START,
            }));
        }
        section.add_child(copy);
        const status = codexUsageStatus(window.remainingPercent);
        section.add_child(new St.Label({
            text: `${status.emoji} ${window.remainingPercent}% remaining`,
            style_class: 'shadow-five-hour-value',
            style: `color: ${resolveAccent(this.context.settings)};`,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        return section;
    }

    _tokenActivity(usage) {
        const card = new St.BoxLayout({
            vertical: true,
            style_class: 'shadow-secondary-surface shadow-token-activity',
            x_expand: true,
        });
        card.add_child(new St.Label({
            text: 'TOKEN ACTIVITY',
            style_class: 'shadow-section-label',
            x_align: Clutter.ActorAlign.START,
        }));
        if (!usage) {
            card.add_child(new St.Label({
                text: 'Tokens and peak time · Not reported by Codex',
                style_class: 'shadow-token-note shadow-muted',
                x_align: Clutter.ActorAlign.START,
            }));
            return card;
        }

        const metrics = [
            ['Today', this._formatTokens(usage.todayTokens)],
            ['Lifetime', this._formatTokens(usage.lifetimeTokens)],
            ['Peak day', this._formatUsageDate(usage.peakDate)],
            ['Peak tokens', this._formatTokens(usage.peakDailyTokens)],
        ];
        for (let index = 0; index < metrics.length; index += 2) {
            const row = new St.BoxLayout({style_class: 'shadow-token-row', x_expand: true});
            row.add_child(this._tokenMetric(...metrics[index]));
            row.add_child(this._tokenMetric(...metrics[index + 1]));
            card.add_child(row);
        }
        card.add_child(new St.Label({
            text: 'Peak hour · Not reported (Codex provides daily totals)',
            style_class: 'shadow-token-note shadow-muted',
            x_align: Clutter.ActorAlign.START,
        }));
        return card;
    }

    _tokenMetric(label, value) {
        const metric = new St.BoxLayout({vertical: true, x_expand: true});
        metric.add_child(new St.Label({text: label, style_class: 'shadow-metadata-label'}));
        metric.add_child(new St.Label({
            text: value ?? 'Not reported',
            style_class: 'shadow-metadata-value',
        }));
        return metric;
    }

    _formatTokens(value) {
        return Number.isSafeInteger(value) ? new Intl.NumberFormat('en-US').format(value) : null;
    }

    _formatUsageDate(value) {
        if (typeof value !== 'string')
            return null;
        const [year, month, day] = value.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return Number.isFinite(date.getTime())
            ? date.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})
            : null;
    }

    _facts(state) {
        const items = [];
        if (state.resetCreditsAvailable > 0)
            items.push(['Reset credits', String(state.resetCreditsAvailable)]);
        if (state.clientVersion)
            items.push(['Client', state.clientVersion]);
        if (!items.length)
            return null;
        const row = new St.BoxLayout({style_class: 'shadow-metadata-row', x_expand: true});
        for (const [label, value] of items) {
            const fact = new St.BoxLayout({vertical: true, x_expand: true});
            fact.add_child(new St.Label({text: label, style_class: 'shadow-metadata-label'}));
            fact.add_child(new St.Label({text: value, style_class: 'shadow-metadata-value'}));
            row.add_child(fact);
        }
        return row;
    }

    _footer(state) {
        let text = `Updated ${formatClock(state.lastSuccessfulRefresh)}`;
        if (state.status === 'stale' || state.status === 'cached')
            text += ' · Cached';
        else if (state.status === 'refreshing')
            text = `Updating… · ${text}`;
        return new St.Label({
            text,
            style_class: 'shadow-provider-footer shadow-muted',
            x_align: Clutter.ActorAlign.START,
        });
    }

    _openCodex() {
        launchUri('codex://', this.context.logger).catch(() =>
            this.context.notify?.('Shadowokx Panel', 'Codex could not be opened.'));
    }

    async _share(state) {
        if (this._sharing || (!state.weekly && !state.fiveHour))
            return;
        this._sharing = true;
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
            });
            const uri = Gio.File.new_for_path(result.directoryPath).get_uri();
            this.context.notify?.('Usage image saved', result.fileName, {
                actionLabel: 'Open folder',
                action: () => launchUri(uri, this.context.logger).catch(() => {}),
            });
        } catch (error) {
            this.context.logger?.debug('codex.share.failed', {code: error.code ?? 'image-export'});
            this.context.notify?.(
                'Share failed',
                'The usage image could not be saved.'
            );
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

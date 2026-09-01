import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {formatCountdown, formatRelativeAge, formatResetDate} from '../../lib/format.js';
import {CODEX_TIMED_LABEL_INTERVAL} from '../../lib/constants.js';
import {normalizeSparklineBuckets, sparklineDayLabels} from '../../lib/sparkline.js';
import {codexUsageStatus} from '../../lib/summary.js';
import {launchUri} from '../../services/launcher.js';
import {
    ProgressMeter,
    animationsEnabled,
    animateRefreshButton,
    attachTooltip,
    fitScrollToContent,
    iconButton,
    moduleIconButton,
    moduleIcon,
    pageTitle,
    resolveAccent,
    resetScrollPosition,
    scrollContainer,
    sectionTitle,
    stateMessage,
    statusPill,
    textButton,
} from '../../ui/components.js';
import {BasePage} from '../basePage.js';
import {exportCodexSummaryImage} from './shareImage.js';
import {localUsageDateKey} from './normalize.js';
import {tokenSparkline} from './sparkline.js';

function contentSignature(state) {
    if (!state?.lastSuccessfulRefresh) {
        return JSON.stringify({
            status: state?.status ?? null,
            errorCode: state?.errorCode ?? null,
            error: state?.error ?? null,
        });
    }
    return JSON.stringify({
        weekly: state.weekly,
        fiveHour: state.fiveHour,
        resetCreditsAvailable: state.resetCreditsAvailable,
        tokenUsage: state.tokenUsage,
    });
}

export class CodexPage extends BasePage {
    constructor(context) {
        super(context, 'codex');
        this._provider = context.codexProvider;
        this._sharing = false;
        this._destroyed = false;
        this._popupOpen = false;
        this._lastWeeklyPercent = null;
        this._hasRendered = false;
        this._stateDirty = true;
        this._renderedSignature = null;
        this._timedLabels = [];
        this._graphHasAppeared = false;
        this._refreshButton = null;
        this._shareCancellable = null;
        this.track(this._provider.subscribe(state => {
            const nextSignature = contentSignature(state);
            const contentChanged = nextSignature !== this._renderedSignature;
            this._stateDirty ||= contentChanged;
            if (!this._hasRendered || this._popupOpen && contentChanged) {
                this._render();
            } else if (this._popupOpen) {
                this._setRefreshState(state.status === 'refreshing' || state.status === 'loading');
                this._refreshTimedLabels();
            }
        }));
    }

    onPopupOpened() {
        this._popupOpen = true;
        if (this._stateDirty) {
            this._lastWeeklyPercent = null;
            this._render();
        } else {
            this._refreshTimedLabels();
            this.fit();
        }
        this.context.scheduler.every('codex-timed-labels', CODEX_TIMED_LABEL_INTERVAL, () =>
            this._refreshTimedLabels());
    }

    onPopupClosed() {
        this._popupOpen = false;
        this._stopRefreshAnimation();
        this.context.scheduler.cancel('codex-timed-labels');
    }

    activate() {
        if (this._destroyed || this._pageDestroyed)
            return;
        this.fit();
        resetScrollPosition(this._scroll);
    }

    fit() {
        if (this._destroyed || this._pageDestroyed)
            return;
        fitScrollToContent(this._scroll, this._scrollContent, this.context, this.actor);
    }

    _render() {
        if (this._destroyed || this._pageDestroyed || !this.actor)
            return;
        const state = this._provider.getState();
        let nextScroll = null;
        let nextScrollContent = null;
        let nextRefreshButton = null;
        const nextTimedLabels = [];
        this._buildingTimedLabels = nextTimedLabels;
        const rendered = this.replaceContent(page => {
            const actions = this._actions(state);
            nextRefreshButton = actions._shadowRefreshButton;
            page.add_child(pageTitle(
                'Codex Usage',
                actions,
                moduleIcon(this.context.extension, 'codex', 19, 'shadow-page-brand-icon')
            ));

            if (state.status === 'loading' && !state.lastSuccessfulRefresh) {
                page.add_child(stateMessage(
                    'content-loading-symbolic',
                    'Loading Codex usage',
                    'Reading limits from the local Codex app-server…'
                ));
                return;
            }
            if (state.status === 'error' && !state.lastSuccessfulRefresh) {
                page.add_child(stateMessage(
                    'dialog-warning-symbolic',
                    state.errorCode === 'not-installed'
                        ? 'Codex not detected'
                        : 'Codex usage unavailable',
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

            if (this.context.settings.get_boolean('show-codex-insights')) {
                const insight = this._tokenInsight(state.tokenUsage);
                if (insight)
                    content.add_child(insight);
            }

            const facts = this._facts(state);
            if (facts)
                content.add_child(facts);
            nextScrollContent = content;
            nextScroll = scrollContainer(content, 'shadow-codex-scroll');
            page.add_child(nextScroll);
        });
        this._buildingTimedLabels = null;
        if (rendered) {
            this._scrollContent = nextScrollContent;
            this._scroll = nextScroll;
            this._hasRendered = true;
            this._stateDirty = false;
            this._renderedSignature = contentSignature(state);
            this._refreshButton = nextRefreshButton;
            this._timedLabels = nextTimedLabels;
        }
        this.fit();
    }

    _actions(state) {
        const actions = new St.BoxLayout({style_class: 'shadow-title-actions'});
        actions.add_child(moduleIconButton(
            this.context.extension,
            'codex',
            'Open Codex application',
            () => this._openCodex(),
            'shadow-icon-button shadow-action-icon-button'
        ));
        const refreshing = state.status === 'refreshing' || state.status === 'loading';
        const refresh = iconButton(
            refreshing ? 'process-working-symbolic' : 'view-refresh-symbolic',
            refreshing ? 'Refreshing Codex usage' : 'Refresh Codex usage',
            () => this._provider.refresh(true),
            'shadow-icon-button shadow-action-icon-button'
        );
        refresh.reactive = !refreshing;
        refresh.can_focus = !refreshing;
        this._refreshIcon = animateRefreshButton(
            refresh,
            this.context.settings,
            refreshing && this._popupOpen
        );
        actions._shadowRefreshButton = refresh;
        actions.add_child(refresh);
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
        heading.add_child(sectionTitle('Weekly capacity'));
        if (window) {
            const status = codexUsageStatus(window.remainingPercent);
            const tone = window.remainingPercent >= 60
                ? 'accent'
                : window.remainingPercent >= 30 ? 'warning' : 'danger';
            heading.add_child(statusPill(this.context.settings, status.label, tone));
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

        const value = new St.BoxLayout({
            style_class: 'shadow-weekly-value-row',
            y_align: Clutter.ActorAlign.CENTER,
        });
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

        const animate = this._popupOpen && this._lastWeeklyPercent !== null &&
            this._lastWeeklyPercent !== window.remainingPercent &&
            animationsEnabled(this.context.settings);
        this._lastWeeklyPercent = window.remainingPercent;
        card.add_child(new ProgressMeter(
            window.remainingPercent,
            resolveAccent(this.context.settings),
            'remaining',
            animate
        ).actor);

        const legend = new St.BoxLayout({
            style_class: 'shadow-progress-legend',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        legend.add_child(new St.Label({
            text: `${100 - window.remainingPercent}% used`,
            style_class: 'shadow-muted',
            x_expand: true,
        }));
        legend.add_child(new St.Label({
            text: `${window.remainingPercent}% available`,
            style_class: 'shadow-progress-available',
        }));
        card.add_child(legend);

        if (this.context.settings.get_boolean('show-codex-reset-time')) {
            const reset = new St.BoxLayout({style_class: 'shadow-weekly-reset', x_expand: true});
            reset.add_child(this._timedLabel(
                () => formatCountdown(window.resetsAt),
                {
                style_class: 'shadow-reset-countdown',
                x_expand: true,
                }
            ));
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
            style_class: 'shadow-secondary-surface shadow-five-hour-section',
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
                text: 'Not reported by this session.',
                style_class: 'shadow-muted',
                x_align: Clutter.ActorAlign.START,
            }));
            section.add_child(copy);
            section.add_child(statusPill(this.context.settings, 'Unavailable', 'neutral'));
            return section;
        }

        if (this.context.settings.get_boolean('show-codex-reset-time')) {
            copy.add_child(this._timedLabel(
                () => formatCountdown(window.resetsAt),
                {
                style_class: 'shadow-muted',
                x_align: Clutter.ActorAlign.START,
                }
            ));
        }
        section.add_child(copy);
        section.add_child(new St.Label({
            text: `${window.remainingPercent}% remaining`,
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
        const heading = new St.BoxLayout({style_class: 'shadow-token-heading', x_expand: true});
        heading.add_child(sectionTitle('Token activity'));
        if (usage?.dailyBuckets?.length >= 2) {
            heading.add_child(statusPill(
                this.context.settings,
                '7-day history',
                'neutral',
                'document-open-recent-symbolic'
            ));
        }
        card.add_child(heading);
        if (!usage) {
            card.add_child(new St.Label({
                text: 'Token activity is not reported by this Codex session.',
                style_class: 'shadow-token-note shadow-muted',
                x_align: Clutter.ActorAlign.START,
            }));
            return card;
        }

        if (this.context.settings.get_boolean('show-codex-token-lifetime') &&
            Number.isSafeInteger(usage.lifetimeTokens)) {
            const lifetime = this._tokenMetric(
                'Lifetime tokens',
                this._formatCompactTokens(usage.lifetimeTokens),
                true
            );
            lifetime.accessible_name = `Lifetime tokens ${this._formatTokens(usage.lifetimeTokens)}`;
            attachTooltip(lifetime, `${this._formatTokens(usage.lifetimeTokens)} tokens`);
            card.add_child(lifetime);
        }

        if (this.context.settings.get_boolean('show-codex-token-stats')) {
            const sparkline = this._tokenSparkline(usage.dailyBuckets);
            if (sparkline)
                card.add_child(sparkline);
            else
                card.add_child(new St.Label({
                    text: 'Not enough history yet',
                    style_class: 'shadow-token-history-empty shadow-muted',
                }));

            const stats = new St.BoxLayout({style_class: 'shadow-token-row', x_expand: true});
            const today = usage.dailyBuckets?.find(
                bucket => bucket.date === localUsageDateKey(Date.now())
            );
            const todayMetric = this._tokenMetric(
                'Today',
                Number.isSafeInteger(today?.tokens)
                    ? this._formatCompactTokens(today.tokens)
                    : 'Unavailable'
            );
            if (Number.isSafeInteger(today?.tokens)) {
                attachTooltip(todayMetric, `${this._formatTokens(today.tokens)} tokens`);
                todayMetric.accessible_name = `Today ${this._formatTokens(today.tokens)} tokens`;
            }
            stats.add_child(todayMetric);
            if (Number.isSafeInteger(usage.peakDailyTokens))
                stats.add_child(this._tokenMetric('Peak', this._formatCompactTokens(usage.peakDailyTokens)));
            const peakDate = this._formatUsageDate(usage.peakDate);
            if (peakDate)
                stats.add_child(this._tokenMetric('Peak day', peakDate));
            if (stats.get_children().length > 0)
                card.add_child(stats);
        }
        return card;
    }

    _tokenSparkline(buckets) {
        const normalized = normalizeSparklineBuckets(buckets);
        if (normalized.length < 2)
            return null;
        const sparkline = new St.BoxLayout({
            vertical: true,
            style_class: 'shadow-token-sparkline-wrap',
            x_expand: true,
        });
        const shouldAnimate = this._popupOpen && !this._graphHasAppeared &&
            animationsEnabled(this.context.settings);
        const chart = tokenSparkline(
            normalized,
            resolveAccent(this.context.settings),
            shouldAnimate,
            bucket => `${this._formatUsageDate(bucket.date)}\n` +
                `${this._formatTokens(bucket.tokens)} tokens`
        );
        if (this._popupOpen)
            this._graphHasAppeared = true;
        chart.accessible_name = normalized.map(bucket =>
            `${this._formatUsageDate(bucket.date)}, ${this._formatTokens(bucket.tokens)} tokens`
        ).join('; ');
        sparkline.add_child(chart);
        const dayLabels = this._sparklineDayLabels(normalized);
        if (dayLabels.length) {
            const timeline = new St.Widget({
                style_class: 'shadow-spark-days',
                x_expand: true,
                height: 12,
                layout_manager: new Clutter.FixedLayout(),
            });
            const labels = [];
            for (const day of dayLabels) {
                const actor = new St.Label({
                    text: day.label,
                    style_class: 'shadow-spark-day',
                    accessible_name: this._formatUsageDate(day.date),
                });
                labels.push({actor, position: day.position});
                timeline.add_child(actor);
            }
            timeline.connect('notify::allocation', () => {
                const width = timeline.width;
                if (width <= 16)
                    return;
                labels.forEach(({actor, position}) => {
                    const [, labelWidth] = actor.get_preferred_width(-1);
                    const center = 8 + position * (width - 16);
                    const x = Math.max(0, Math.min(
                        Math.round(center - labelWidth / 2),
                        width - labelWidth
                    ));
                    actor.set_position(x, 0);
                });
            });
            sparkline.add_child(timeline);
        }
        return sparkline;
    }

    _sparklineDayLabels(buckets) {
        return sparklineDayLabels(buckets);
    }

    _tokenInsight(usage) {
        const prior = usage.dailyBuckets?.filter(bucket => bucket.date !== localUsageDateKey(Date.now())) ?? [];
        if (!Number.isSafeInteger(usage.todayTokens) || prior.length < 2)
            return null;
        const average = prior.reduce((total, bucket) => total + bucket.tokens, 0) / prior.length;
        if (!(average > 0))
            return null;
        const ratio = usage.todayTokens / average;
        const message = ratio >= 1.25
            ? 'Today is above your recent daily average.'
            : ratio <= 0.75
                ? 'Today is below your recent daily average.'
                : 'Today is close to your recent daily average.';
        const row = new St.BoxLayout({
            style_class: 'shadow-page-insight shadow-secondary-surface',
            x_expand: true,
        });
        row.add_child(new St.Icon({
            icon_name: ratio >= 1.25 ? 'dialog-warning-symbolic' : 'emblem-ok-symbolic',
            icon_size: 15,
            style: `color: ${resolveAccent(this.context.settings)};`,
        }));
        row.add_child(new St.Label({text: message, style_class: 'shadow-page-insight-text'}));
        return row;
    }

    _tokenMetric(label, value, primary = false) {
        const metric = new St.BoxLayout({
            vertical: true,
            style_class: primary ? 'shadow-token-metric shadow-token-primary' : 'shadow-token-metric',
            x_expand: true,
        });
        const labelActor = new St.Label({text: label, style_class: 'shadow-token-label'});
        const valueActor = new St.Label({
            text: value,
            style_class: primary ? 'shadow-token-primary-value' : 'shadow-token-value',
        });
        if (primary) {
            metric.add_child(valueActor);
            metric.add_child(labelActor);
        } else {
            metric.add_child(labelActor);
            metric.add_child(valueActor);
        }
        return metric;
    }

    _formatTokens(value) {
        return Number.isSafeInteger(value) ? new Intl.NumberFormat('en-US').format(value) : null;
    }

    _formatCompactTokens(value) {
        if (!Number.isSafeInteger(value))
            return null;
        const units = [[1_000_000_000, 'B'], [1_000_000, 'M'], [1_000, 'K']];
        for (const [divisor, suffix] of units) {
            if (value >= divisor) {
                return `${(value / divisor).toFixed(1).replace(/\.0$/, '')}${suffix}`;
            }
        }
        return String(value);
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
        const hasCredits = state.resetCreditsAvailable > 0;
        const hasUpdate = Number.isFinite(state.lastSuccessfulRefresh);
        if (!hasCredits && !hasUpdate)
            return null;
        const row = new St.BoxLayout({style_class: 'shadow-codex-footer', x_expand: true});
        const credits = new St.BoxLayout({style_class: 'shadow-footer-credits', x_expand: true});
        if (hasCredits) {
            credits.add_child(new St.Label({
                text: 'Reset credits',
                style_class: 'shadow-footer-label',
            }));
            credits.add_child(new St.Label({
                text: String(state.resetCreditsAvailable),
                style_class: 'shadow-footer-value',
            }));
        }
        row.add_child(credits);
        if (hasUpdate) {
            row.add_child(this._timedLabel(
                () => `Updated ${formatRelativeAge(
                    this._provider.getState()?.lastSuccessfulRefresh
                )}`,
                {
                style_class: 'shadow-footer-updated',
                x_align: Clutter.ActorAlign.END,
                }
            ));
        }
        return row;
    }

    _timedLabel(textProvider, properties) {
        const actor = new St.Label({text: textProvider(), ...properties});
        this._buildingTimedLabels?.push({actor, textProvider});
        return actor;
    }

    _refreshTimedLabels() {
        if (this._destroyed || this._pageDestroyed || !this._popupOpen)
            return;
        for (const {actor, textProvider} of this._timedLabels) {
            if (actor && !actor.is_finalized?.())
                actor.text = textProvider();
        }
    }

    _setRefreshState(refreshing) {
        const button = this._refreshButton;
        if (!button)
            return;
        this._stopRefreshAnimation();
        button.reactive = !refreshing;
        button.can_focus = !refreshing;
        button.accessible_name = refreshing ? 'Refreshing Codex usage' : 'Refresh Codex usage';
        button.child.icon_name = refreshing
            ? 'process-working-symbolic'
            : 'view-refresh-symbolic';
        this._refreshIcon = animateRefreshButton(
            button,
            this.context.settings,
            refreshing && this._popupOpen
        );
    }

    _stopRefreshAnimation() {
        this._refreshIcon?.remove_all_transitions();
        if (this._refreshIcon)
            this._refreshIcon.rotation_angle_z = 0;
        this._refreshIcon = null;
    }

    _openCodex() {
        launchUri('codex://', this.context.logger).catch(() =>
            this.context.notify?.('Shadowokx Panel', 'Codex could not be opened.'));
    }

    async _share(state) {
        if (this._sharing || (!state.weekly && !state.fiveHour))
            return;
        this._sharing = true;
        const cancellable = new Gio.Cancellable();
        this._shareCancellable = cancellable;
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
                cancellable,
            });
            const uri = Gio.File.new_for_path(result.directoryPath).get_uri();
            this.context.notify?.('Usage image saved', result.fileName, {
                actionLabel: 'Open folder',
                action: () => launchUri(uri, this.context.logger).catch(() => {}),
            });
        } catch (error) {
            if (this._destroyed ||
                error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            this.context.logger?.debug('codex.share.failed', {code: error.code ?? 'image-export'});
            this.context.notify?.(
                'Share failed',
                'The usage image could not be saved.'
            );
        } finally {
            if (this._shareCancellable === cancellable)
                this._shareCancellable = null;
            this._sharing = false;
            this._stateDirty = true;
            if (!this._destroyed && this._popupOpen)
                this._render();
        }
    }

    destroy() {
        this._destroyed = true;
        this._shareCancellable?.cancel();
        this._shareCancellable = null;
        this._stopRefreshAnimation();
        this.context.scheduler.cancel('codex-timed-labels');
        super.destroy();
        this._scroll = null;
        this._scrollContent = null;
        this._refreshButton = null;
        this._timedLabels = [];
    }
}

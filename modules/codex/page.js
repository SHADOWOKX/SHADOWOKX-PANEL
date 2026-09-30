import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {formatCountdown, formatRelativeAge, formatResetDate} from '../../lib/format.js';
import {CODEX_TIMED_LABEL_INTERVAL} from '../../lib/constants.js';
import {accountActivityCalendar, weeklyAccountActivity} from '../../lib/activity.js';
import {codexUsageStatus, codexLimitColor} from '../../lib/summary.js';
import {launchUri} from '../../services/launcher.js';
import {
    ProgressMeter,
    animationsEnabled,
    animateRefreshButton,
    attachTooltip,
    iconButton,
    moduleIconButton,
    moduleIcon,
    pageTitle,
    resolveAccent,
    sectionTitle,
    stateMessage,
    statusPill,
    textButton,
} from '../../ui/components.js';
import {BasePage} from '../basePage.js';
import {exportCodexSummaryImage} from './shareImage.js';
import {localUsageDateKey} from './normalize.js';
import {costRow} from './costRow.js';
import {accountHeatmap} from './heatmap.js';

function contentSignature(state) {
    const {updatedAt: _accountUpdatedAt, ...accountUsageData} = state?.accountTokenUsage ?? {};
    const accountTokenUsage = state?.accountTokenUsage ? accountUsageData : null;
    const {updatedAt: _costUpdatedAt, ...costUsageData} = state?.costUsage ?? {};
    const costUsage = state?.costUsage ? costUsageData : null;
    if (!state?.lastSuccessfulRefresh) {
        return JSON.stringify({
            status: state?.status ?? null,
            errorCode: state?.errorCode ?? null,
            error: state?.error ?? null,
            accountTokenUsage,
        });
    }
    return JSON.stringify({
        weekly: state.weekly,
        fiveHour: state.fiveHour,
        resetCreditsAvailable: state.resetCreditsAvailable,
        accountTokenUsage,
        costUsage,
        stale: state.stale,
        calendarDate: localUsageDateKey(Date.now()),
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
        this._hasUsageContent = false;
        this._stateDirty = true;
        this._renderedSignature = null;
        this._timedLabels = [];
        this._activityView = 'daily';
        this._refreshButton = null;
        this._refreshState = null;
        this._accountStatusLabel = null;
        this._shareCancellable = null;
        this.track(this._provider.subscribe(state => {
            const nextSignature = contentSignature(state);
            const contentChanged = nextSignature !== this._renderedSignature;
            this._stateDirty ||= contentChanged;
            const primeFirstUsage = !this._hasUsageContent && state.lastSuccessfulRefresh &&
                !this.context.isPopupOpen?.();
            if (!this._hasRendered || primeFirstUsage ||
                this._popupOpen && contentChanged) {
                this._render();
            } else if (this._popupOpen) {
                this._setRefreshState(state.status === 'refreshing' || state.status === 'loading');
                this._syncAccountStatus(state.accountUsageStatus);
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
            const state = this._provider.getState();
            this._setRefreshState(state.status === 'refreshing' || state.status === 'loading');
            this._syncAccountStatus(state.accountUsageStatus);
            this._refreshTimedLabels();
        }
        this.context.scheduler.every('codex-timed-labels', CODEX_TIMED_LABEL_INTERVAL, () =>
            this._refreshTimedLabels());
    }

    onPopupClosed() {
        this._popupOpen = false;
        this._stopRefreshAnimation();
        this._refreshState = null;
        this.context.scheduler.cancel('codex-timed-labels');
    }

    _render() {
        if (this._destroyed || this._pageDestroyed || !this.actor)
            return;
        const state = this._provider.getState();
        let nextRefreshButton = null;
        const nextTimedLabels = [];
        this._buildingTimedLabels = nextTimedLabels;
        this._buildingAccountStatusLabel = null;
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
                content.add_child(this._weeklyHero(state.weekly, state.accountTokenUsage, state.costUsage, state.accountUsageStatus));
                sectionCount++;
            }
            if (this.context.settings.get_boolean('show-codex-five-hour') && state.fiveHour) {
                content.add_child(this._fiveHourSection(state.fiveHour));
                sectionCount++;
            }
            if (sectionCount === 0) {
                content.add_child(new St.Label({
                    text: 'No usage window reported by Codex.',
                    style_class: 'shadow-inline-empty shadow-muted',
                }));
            }

            if (!this.context.settings.get_boolean('show-codex-weekly'))
                content.add_child(this._costRow(state.accountTokenUsage, state.costUsage, state.accountUsageStatus));

            content.add_child(this._tokenActivity(state.accountTokenUsage));

            if (this.context.settings.get_boolean('show-codex-insights')) {
                const insight = this._tokenInsight(state.accountTokenUsage);
                if (insight)
                    content.add_child(insight);
            }

            const facts = this._facts(state);
            if (facts)
                content.add_child(facts);
            page.add_child(content);
        });
        this._buildingTimedLabels = null;
        if (rendered) {
            this._hasRendered = true;
            this._hasUsageContent ||= Boolean(state.lastSuccessfulRefresh);
            this._stateDirty = false;
            this._renderedSignature = contentSignature(state);
            this._refreshButton = nextRefreshButton;
            this._refreshState = this._popupOpen
                ? state.status === 'refreshing' || state.status === 'loading'
                : null;
            this._accountStatusLabel = this._buildingAccountStatusLabel;
            this._timedLabels = nextTimedLabels;
        }
        this._buildingAccountStatusLabel = null;
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

    _weeklyHero(window, accountTokenUsage, costUsage, accountUsageStatus) {
        const card = new St.BoxLayout({
            vertical: true,
            style_class: 'shadow-card shadow-weekly-hero',
            x_expand: true,
        });
        const heading = new St.BoxLayout({style_class: 'shadow-usage-heading', x_expand: true});
        heading.add_child(sectionTitle('Weekly allowance'));
        if (window) {
            const status = codexUsageStatus(window.remainingPercent);
            const tone = window.remainingPercent >= 60
                ? 'accent'
                : window.remainingPercent >= 30 ? 'warning' : 'danger';
            const pill = statusPill(this.context.settings, status.label, tone);
            pill.get_first_child().style = `background-color: ${codexLimitColor(window.remainingPercent)};`;
            heading.add_child(pill);
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
            card.add_child(this._costRow(accountTokenUsage, costUsage, accountUsageStatus));
            return card;
        }

        const value = new St.BoxLayout({
            style_class: 'shadow-weekly-value-row',
            y_align: Clutter.ActorAlign.CENTER,
        });
        value.add_child(new St.Label({
            text: `${window.remainingPercent}%`,
            style_class: 'shadow-weekly-value',
            style: `color: ${codexLimitColor(window.remainingPercent)};`,
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
            codexLimitColor(window.remainingPercent),
            'remaining',
            animate
        ).actor);

        card.add_child(this._costRow(accountTokenUsage, costUsage, accountUsageStatus));

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
                style_class: 'shadow-reset-date shadow-muted',
            }));
            card.add_child(reset);
        }
        return card;
    }

    _costRow(accountTokenUsage, costUsage, accountUsageStatus) {
        const row = costRow(accountTokenUsage, costUsage, accountUsageStatus);
        this._buildingAccountStatusLabel = row._shadowAccountStatusLabel;
        return row;
    }

    _syncAccountStatus(accountUsageStatus) {
        const label = this._accountStatusLabel;
        if (!label)
            return;
        const text = accountUsageStatus === 'refreshing'
            ? 'ACCOUNT TOKENS · CHECKING' : 'ACCOUNT TOKENS';
        if (label.text !== text)
            label.text = text;
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
            style: `color: ${codexLimitColor(window.remainingPercent)};`,
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
            const lifetime = new St.Label({
                text: `${this._formatCompactTokens(usage.lifetimeTokens)} lifetime`,
                style_class: 'shadow-token-lifetime',
            });
            lifetime.accessible_name = `Lifetime tokens ${this._formatTokens(usage.lifetimeTokens)}`;
            attachTooltip(lifetime, `${this._formatTokens(usage.lifetimeTokens)} account tokens`);
            heading.add_child(lifetime);
        }

        if (this.context.settings.get_boolean('show-codex-token-stats')) {
            const calendar = accountActivityCalendar(usage.activityBuckets ?? usage.dailyBuckets,
                localUsageDateKey(Date.now()));
            const weekly = weeklyAccountActivity(calendar);
            const toolbar = new St.BoxLayout({style_class: 'shadow-activity-toolbar', x_expand: true});
            toolbar.add_child(new St.Label({text: 'Account history · 12 months',
                style_class: 'shadow-activity-subtitle shadow-muted', x_expand: true,
                y_align: Clutter.ActorAlign.CENTER}));
            const buttons = new Map();
            const views = new Map();
            const select = view => {
                this._activityView = view;
                for (const [id, actor] of views)
                    actor.visible = id === view;
                for (const [id, button] of buttons) {
                    button.checked = id === view;
                    button.accessible_name = `${id === 'daily' ? 'Days' : 'Weeks'}${id === view ? ', selected' : ''}`;
                    if (id === view)
                        button.add_style_class_name('shadow-activity-view-active');
                    else
                        button.remove_style_class_name('shadow-activity-view-active');
                }
                const data = view === 'daily' ? calendar : weekly;
                const peak = data.peak;
                const values = [
                    [view === 'daily' ? 'Active days' : 'Active weeks', String(data.activeDays)],
                    [view === 'daily' ? 'Daily peak' : 'Weekly peak', peak ? this._formatCompactTokens(peak.tokens) : '—'],
                    [view === 'daily' ? 'Peak day' : 'Week starting', peak ? this._formatUsageDate(peak.date)?.replace(/, \d{4}$/, '') : '—'],
                ];
                metrics.forEach((metric, index) => {
                    metric.get_first_child().text = values[index][0];
                    metric.get_last_child().text = values[index][1];
                });
            };
            for (const [id, title] of [['daily', 'Days'], ['weekly', 'Weeks']]) {
                const button = new St.Button({label: title, can_focus: true, reactive: true,
                    toggle_mode: true, style_class: `shadow-activity-view shadow-activity-view-${id}`});
                button.connect('clicked', () => select(id));
                buttons.set(id, button);
                toolbar.add_child(button);
            }
            card.add_child(toolbar);
            for (const [id, data] of [['daily', calendar], ['weekly', weekly]]) {
                const actor = accountHeatmap(data, resolveAccent(this.context.settings), bucket => {
                    const date = this._formatUsageDate(bucket.date);
                    const value = bucket.tokens === null ? 'Not reported' : `${this._formatTokens(bucket.tokens)} tokens`;
                    return id === 'daily' ? `${date} · ${value}`
                        : `${date} · ${value} · ${bucket.reportedDays}/${bucket.expectedDays} days`;
                });
                views.set(id, actor);
                card.add_child(actor);
            }

            const stats = new St.BoxLayout({style_class: 'shadow-token-row', x_expand: true});
            const metrics = Array.from({length: 3}, () => this._tokenMetric('', '—'));
            metrics.forEach(metric => stats.add_child(metric));
            card.add_child(stats);
            select(this._activityView);
        }
        return card;
    }

    _tokenInsight(usage) {
        const prior = usage?.dailyBuckets?.filter(bucket => bucket.date !== localUsageDateKey(Date.now())) ?? [];
        if (!Number.isSafeInteger(usage?.todayTokens) || prior.length < 2)
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

    _tokenMetric(label, value) {
        const metric = new St.BoxLayout({
            vertical: true, style_class: 'shadow-token-metric', x_expand: true,
        });
        metric.add_child(new St.Label({text: label, style_class: 'shadow-token-label'}));
        metric.add_child(new St.Label({text: value, style_class: 'shadow-token-value'}));
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
                () => {
                    const current = this._provider.getState();
                    const tokens = current?.accountTokenUsage;
                    if (current?.accountUsageStatus === 'refreshing')
                        return 'Checking account tokens…';
                    const label = current?.stale ? 'Cached' : tokens ? 'Tokens checked' : 'Limits checked';
                    return `${label} ${formatRelativeAge(tokens?.updatedAt ?? current?.lastSuccessfulRefresh)}`;
                },
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
            if (actor && !actor.is_finalized?.()) {
                const text = textProvider();
                if (actor.text !== text)
                    actor.text = text;
            }
        }
    }

    _setRefreshState(refreshing) {
        const button = this._refreshButton;
        if (!button || this._refreshState === refreshing)
            return;
        this._refreshState = refreshing;
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
        if (this._actorDestroyed)
            this._refreshIcon = null;
        this._stopRefreshAnimation();
        this.context.scheduler.cancel('codex-timed-labels');
        super.destroy();
        this._refreshButton = null;
        this._accountStatusLabel = null;
        this._timedLabels = [];
    }
}

// Command Code presentation uses existing shared styles; Codex stays unchanged.
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import {formatCountdown, formatRelativeAge, formatResetDate} from '../../lib/format.js';
import {codexLimitColor, codexUsageStatus} from '../../lib/summary.js';
import {animationsEnabled, attachTooltip, ProgressMeter, sectionTitle, statusPill} from '../../ui/components.js';

const numbers = new Intl.NumberFormat(undefined, {maximumFractionDigits: 2});
const amount = value => Number.isFinite(value) ? numbers.format(value) : 'Unavailable';
const remaining = window => Number.isFinite(window?.usedPercent)
    ? Math.max(0, Math.min(100, Math.round(100 - window.usedPercent))) : null;
const label = (text, style_class, props = {}) => new St.Label({text, style_class, ...props});

function metric(parent, title, value, exact = null) {
    const row = new St.BoxLayout({style_class: 'shadow-cost-period', x_expand: true,
        y_align: Clutter.ActorAlign.CENTER});
    row.add_child(label(title, 'shadow-muted', {x_expand: true}));
    const number = label(value, 'shadow-cost-amount');
    if (exact !== null) attachTooltip(number, exact);
    row.add_child(number);
    parent.add_child(row);
}

export function commandCodeView(context, body, state, previousRemaining) {
    const data = state.data;
    const usage = data.consumption;
    const windowFor = title => data.windows.find(w => w.label === title &&
        (!w.resetsAt || w.resetsAt > Date.now()));
    const weekly = windowFor('Weekly allowance');
    const fiveHour = windowFor('Five-hour allowance');
    const percent = remaining(weekly);
    const hero = new St.BoxLayout({vertical: true, style_class: 'shadow-card shadow-weekly-hero', x_expand: true});
    const heading = new St.BoxLayout({style_class: 'shadow-usage-heading', x_expand: true});
    heading.add_child(sectionTitle('Weekly allowance'));
    const status = state.status === 'stale' ? 'Stale' : data.warnings?.length ? 'Partial'
        : percent === null ? 'Unavailable' : codexUsageStatus(percent).label;
    const tone = state.status === 'stale' || percent === null ? 'neutral'
        : percent >= 60 ? 'accent' : percent >= 30 ? 'warning' : 'danger';
    const pill = statusPill(context.settings, status, tone);
    if (percent !== null && state.status !== 'stale')
        pill.get_first_child().style = `background-color: ${codexLimitColor(percent)};`;
    attachTooltip(pill, state.error ?? (data.warnings?.length
        ? 'Some account metrics were not returned.' : 'Live Command Code account usage'));
    heading.add_child(pill);
    hero.add_child(heading);
    if (percent !== null) {
        const value = new St.BoxLayout({style_class: 'shadow-weekly-value-row', y_align: Clutter.ActorAlign.CENTER});
        value.add_child(label(`${percent}%`, 'shadow-weekly-value', {style: `color: ${codexLimitColor(percent)};`}));
        value.add_child(label('remaining', 'shadow-weekly-unit', {y_align: Clutter.ActorAlign.END}));
        attachTooltip(value, `${weekly.used} / ${weekly.cap} credits consumed · ${weekly.usedPercent}% used`);
        hero.add_child(value);
        hero.add_child(new ProgressMeter(percent, codexLimitColor(percent), 'remaining',
            previousRemaining !== null && previousRemaining !== percent && animationsEnabled(context.settings)).actor);
    } else {
        hero.add_child(label('Unavailable', 'shadow-weekly-unavailable', {x_align: Clutter.ActorAlign.START}));
    }
    const rows = new St.BoxLayout({vertical: true, style_class: 'shadow-cost-row', x_expand: true});
    const caption = new St.BoxLayout({style_class: 'shadow-cost-caption', x_expand: true});
    caption.add_child(label(state.refreshing ? 'ACCOUNT USAGE · CHECKING' : 'ACCOUNT USAGE', 'shadow-muted', {x_expand: true}));
    rows.add_child(caption);
    metric(rows, 'Monthly · consumed credits', amount(usage.monthlyUsedCredits),
        Number.isFinite(usage.monthlyUsedCredits) ? String(usage.monthlyUsedCredits) : null);
    metric(rows, 'Requests · reported period', amount(usage.requests));
    metric(rows, 'Weekly · consumed / limit', weekly ? `${amount(weekly.used)} / ${amount(weekly.cap)}` : 'Unavailable',
        weekly ? `${weekly.used} / ${weekly.cap} credits` : null);
    const period = usage.periodStart && usage.periodEnd
        ? `${new Date(usage.periodStart).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})} – ${new Date(usage.periodEnd).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}`
        : usage.periodBasis ?? 'Period unavailable';
    const note = label(`Account period · ${period}`, 'shadow-cost-note shadow-muted', {x_expand: true});
    attachTooltip(note, `Reported usage period: ${usage.periodBasis ?? 'Unavailable'}. Monthly allowance cap is not reported; no percentage is estimated.`);
    rows.add_child(note);
    hero.add_child(rows);
    const reset = new St.BoxLayout({style_class: 'shadow-weekly-reset', x_expand: true});
    reset.add_child(label(weekly?.resetsAt ? formatCountdown(weekly.resetsAt / 1000) : 'Reset unavailable',
        'shadow-reset-countdown', {x_expand: true}));
    if (weekly?.resetsAt) reset.add_child(label(formatResetDate(weekly.resetsAt / 1000), 'shadow-reset-date shadow-muted'));
    hero.add_child(reset);
    body.add_child(hero);

    const five = new St.BoxLayout({style_class: 'shadow-secondary-surface shadow-five-hour-section', x_expand: true});
    const copy = new St.BoxLayout({vertical: true, x_expand: true});
    copy.add_child(label('5-Hour Window', 'shadow-card-title', {x_align: Clutter.ActorAlign.START}));
    copy.add_child(label(fiveHour?.resetsAt ? formatCountdown(fiveHour.resetsAt / 1000) : 'Reset unavailable',
        'shadow-muted', {x_align: Clutter.ActorAlign.START}));
    five.add_child(copy);
    const fivePercent = remaining(fiveHour);
    const fiveValue = label(fivePercent === null ? 'Unavailable' : `${fivePercent}% remaining`, 'shadow-five-hour-value',
        {style: `color: ${codexLimitColor(fivePercent)};`, y_align: Clutter.ActorAlign.CENTER});
    if (fiveHour) attachTooltip(fiveValue, `${fiveHour.used} / ${fiveHour.cap} credits consumed · ${fiveHour.usedPercent ?? 'Unavailable'}% used`);
    five.add_child(fiveValue);
    body.add_child(five);

    const activity = new St.BoxLayout({vertical: true, style_class: 'shadow-secondary-surface shadow-token-activity', x_expand: true});
    const activityHeading = new St.BoxLayout({style_class: 'shadow-token-heading', x_expand: true});
    activityHeading.add_child(sectionTitle('Account activity'));
    activityHeading.add_child(label(data.plan ?? 'Unavailable', 'shadow-token-lifetime'));
    activity.add_child(activityHeading);
    const identity = label([data.planStatus, data.account].filter(Boolean).join(' · ') || 'Command Code account', 'shadow-token-note shadow-muted');
    attachTooltip(identity, 'Read-only Command Code API · Refreshes every 3 minutes');
    activity.add_child(identity);
    metric(activity, 'Total consumed · credits', amount(usage.usedCredits),
        Number.isFinite(usage.usedCredits) ? String(usage.usedCredits) : null);
    for (const balance of data.creditBalances) metric(activity, balance.label, amount(balance.amount), String(balance.amount));
    if (usage.periodEnd) metric(activity, 'Billing period ends', new Date(usage.periodEnd).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}));
    body.add_child(activity);
    const footer = new St.BoxLayout({style_class: 'shadow-codex-footer', x_expand: true});
    footer.add_child(new St.Widget({x_expand: true}));
    const refresh = label(state.refreshing ? 'Checking account usage…' : `${state.status === 'stale' ? 'Cached' : 'Usage checked'} ${formatRelativeAge(data.updatedAt)}`,
        'shadow-footer-updated');
    attachTooltip(refresh, `Last successful refresh: ${new Date(data.updatedAt).toLocaleString()}${state.error ? `\n${state.error}` : ''}${state.retryAt > Date.now() ? `\nRetry after ${new Date(state.retryAt).toLocaleTimeString()}` : ''}`);
    footer.add_child(refresh);
    body.add_child(footer);
    return percent;
}

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import {attachTooltip} from '../../ui/components.js';
import {formatCost} from './cost.js';
import {localUsageDateKey} from './normalize.js';

const tokensFormatter = new Intl.NumberFormat('en-US', {maximumFractionDigits: 0});

function shiftDate(date, offset) {
    if (typeof date !== 'string')
        return null;
    const [year, month, day] = date.split('-').map(Number);
    if (![year, month, day].every(Number.isInteger))
        return null;
    return localUsageDateKey(new Date(year, month - 1, day + offset, 12).getTime());
}

function formatDate(date) {
    if (typeof date !== 'string')
        return null;
    const [year, month, day] = date.split('-').map(Number);
    if (![year, month, day].every(Number.isInteger))
        return date;
    return new Date(year, month - 1, day, 12).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric',
    });
}

function accountTokensForDate(accountUsage, date) {
    if (!date)
        return null;
    if (date === accountUsage?.todayDate && Number.isSafeInteger(accountUsage?.todayTokens))
        return accountUsage.todayTokens;
    const bucket = accountUsage?.dailyBuckets?.find(item => item.date === date);
    return Number.isSafeInteger(bucket?.tokens) ? bucket.tokens : null;
}

export function costRow(accountUsage, localUsage, accountUsageStatus) {
    const box = new St.BoxLayout({vertical: true, style_class: 'shadow-cost-row', x_expand: true});
    const todayDate = localUsageDateKey(Date.now());
    const yesterdayDate = shiftDate(todayDate, -1);
    const todayTokens = accountTokensForDate(accountUsage, todayDate);
    const caption = new St.BoxLayout({style_class: 'shadow-cost-caption', x_expand: true});
    const accountStatusLabel = new St.Label({
        text: accountUsageStatus === 'refreshing' ? 'ACCOUNT TOKENS · CHECKING' : 'ACCOUNT TOKENS', style_class: 'shadow-muted', x_expand: true,
    });
    caption.add_child(accountStatusLabel);
    box._shadowAccountStatusLabel = accountStatusLabel;
    box.add_child(caption);
    const periods = [
        {
            title: `Today · ${formatDate(todayDate)}`,
            tokens: todayTokens,
        },
        {
            title: `Yesterday · ${formatDate(yesterdayDate)}`,
            tokens: accountTokensForDate(accountUsage, yesterdayDate),
        },
        {
            title: accountUsage?.dailyBuckets?.length
                ? `Last 7 days · ${accountUsage.dailyBuckets.length} reported` : 'Last 7 days',
            tokens: accountUsage?.sevenDayTokens,
        },
    ];
    for (const period of periods) {
        const row = new St.BoxLayout({style_class: 'shadow-cost-period', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        row.add_child(new St.Label({text: period.title, style_class: 'shadow-muted', x_expand: true}));
        if (Number.isSafeInteger(period.tokens)) {
            row.add_child(new St.Label({
                text: tokensFormatter.format(period.tokens),
                style_class: 'shadow-cost-amount',
            }));
        } else {
            row.add_child(new St.Label({
                text: period.title.startsWith('Today') && accountUsage
                    ? 'Pending' : '—',
                style_class: 'shadow-cost-amount',
            }));
        }
        row.accessible_name = `${period.title}: ${Number.isSafeInteger(period.tokens)
            ? `${tokensFormatter.format(period.tokens)} account tokens`
            : period.title.startsWith('Today') && accountUsage
                ? 'Codex account has not reported this date yet'
                : 'account token total unavailable'}`;
        box.add_child(row);
    }

    const latestDate = accountUsage?.latestReportedDate ?? accountUsage?.dailyBuckets?.at(-1)?.date ?? null;
    if (!accountUsage) {
        const note = new St.Label({
            text: 'Account token data unavailable',
            style_class: 'shadow-cost-note shadow-muted', x_expand: true,
        });
        note.clutter_text.set_line_wrap(true);
        box.add_child(note);
    } else if (!Number.isSafeInteger(todayTokens)) {
        const status = latestDate ? `Account data through ${formatDate(latestDate)}` : 'Today pending from account';
        const note = new St.Label({
            text: status,
            style_class: 'shadow-cost-note shadow-muted', x_expand: true,
        });
        note.clutter_text.set_line_wrap(true);
        note.accessible_name = note.text;
        box.add_child(note);
    }

    if (!localUsage?.available || localUsage.today !== todayDate) {
        box.accessible_name = 'Token totals reported by your Codex account. Missing dates are not estimated.';
        return box;
    }
    const spend = new St.BoxLayout({style_class: 'shadow-spend-summary', x_expand: true});
    const weekStart = shiftDate(todayDate, -6);
    const localDays = localUsage.days.filter(day => day.date >= weekStart && day.date <= todayDate);
    const today = localDays?.find(day => day.date === todayDate);
    const periodsCost = [today, localDays ? {cost: localDays.reduce((sum, day) => sum + day.cost, 0),
        tokens: localDays.reduce((sum, day) => sum + day.tokens, 0),
        unknownTokens: localDays.reduce((sum, day) => sum + day.unknownTokens, 0),
        invalidRecords: localDays.reduce((sum, day) => sum + (day.invalidRecords ?? 0), 0)} : null];
    const amounts = periodsCost.map(period => period &&
        period.tokens > period.unknownTokens ? period.cost : null);
    const incomplete = periodsCost.map(period => Boolean(period && (
        period.unknownTokens > 0 || period.invalidRecords > 0 || localUsage?.failedFiles > 0)));
    for (const [index, title] of ['Today', '7 days'].entries()) {
        const cell = new St.BoxLayout({vertical: true, x_expand: true,
            style_class: 'shadow-spend-cell'});
        cell.add_child(new St.Label({text: `${title} · device estimate`,
            style_class: 'shadow-muted shadow-spend-caption'}));
        const amount = new St.Label({text: Number.isFinite(amounts[index])
            ? `≈${formatCost(amounts[index])}${incomplete[index] ? ' *' : ''}` : '—',
            style_class: 'shadow-spend-value'});
        if (Number.isFinite(amounts[index])) {
            attachTooltip(amount, 'USD estimate for recorded sessions on this device, using model-specific input, cached input and output prices. Not an account bill. ' +
                (incomplete[index] ? 'Partial: some models or records could not be priced. ' : '') +
                `Standard rates; fast-mode premiums and tool fees excluded. Recorded tokens in this period: ${tokensFormatter.format(periodsCost[index]?.tokens ?? 0)}. Prices checked ${localUsage?.priceDate ?? 'unavailable'}.`);
        }
        cell.add_child(amount);
        spend.add_child(cell);
    }
    box.add_child(spend);
    box.accessible_name = 'Token totals reported by your Codex account. Missing dates are not estimated.';
    return box;
}

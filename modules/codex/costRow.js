import Clutter from 'gi://Clutter';
import St from 'gi://St';
import {attachTooltip} from '../../ui/components.js';
import {localUsageDateKey} from './normalize.js';
import {formatCost} from './cost.js';

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

function estimateAccountCost(accountTokens, localCost, localPricedTokens) {
    if (!Number.isSafeInteger(accountTokens) || !Number.isFinite(localCost) ||
        !Number.isSafeInteger(localPricedTokens) || localPricedTokens <= 0)
        return null;
    return localCost / localPricedTokens * accountTokens;
}

function localTotal(days, field) {
    return days.reduce((total, day) => total + (Number.isFinite(day[field]) ? day[field] : 0), 0);
}

export function costRow(usage, accountUsage) {
    const box = new St.BoxLayout({vertical: true, style_class: 'shadow-cost-row', x_expand: true});
    const localDays = usage?.days ?? [];
    const todayDate = localUsageDateKey(Date.now());
    const yesterdayDate = shiftDate(todayDate, -1);
    const weekStartDate = shiftDate(todayDate, -6);
    const localDayForDate = date => localDays.find(day => day.date === date);
    const week = localDays.filter(day => day.date >= weekStartDate && day.date <= todayDate);
    const todayTokens = accountTokensForDate(accountUsage, todayDate);
    const caption = new St.BoxLayout({style_class: 'shadow-cost-caption', x_expand: true});
    caption.add_child(new St.Label({
        text: 'ACCOUNT TOKENS', style_class: 'shadow-muted', x_expand: true,
    }));
    caption.add_child(new St.Label({
        text: '≈ API USD', style_class: 'shadow-muted',
    }));
    box.add_child(caption);
    const periods = [
        {
            title: `Today · ${formatDate(todayDate)}`,
            tokens: todayTokens,
            localCost: localDayForDate(todayDate)?.cost,
            pricedTokens: localDayForDate(todayDate)?.pricedTokens,
        },
        {
            title: `Yesterday · ${formatDate(yesterdayDate)}`,
            tokens: accountTokensForDate(accountUsage, yesterdayDate),
            localCost: localDayForDate(yesterdayDate)?.cost,
            pricedTokens: localDayForDate(yesterdayDate)?.pricedTokens,
        },
        {
            title: 'Last 7 Days',
            tokens: accountUsage?.sevenDayTokens,
            localCost: localTotal(week, 'cost'),
            pricedTokens: localTotal(week, 'pricedTokens'),
        },
    ];
    for (const period of periods) {
        const row = new St.BoxLayout({style_class: 'shadow-cost-period', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        row.add_child(new St.Label({text: period.title, style_class: 'shadow-muted', x_expand: true}));
        const cost = usage?.available
            ? estimateAccountCost(period.tokens, period.localCost, period.pricedTokens) : null;
        if (Number.isSafeInteger(period.tokens)) {
            row.add_child(new St.Label({
                text: tokensFormatter.format(period.tokens),
                style_class: 'shadow-cost-amount',
            }));
            if (cost !== null) {
                const estimate = new St.Label({
                    text: `≈${formatCost(cost)}`,
                    style_class: 'shadow-cost-estimate shadow-muted',
                });
                attachTooltip(estimate,
                    'API estimate: account tokens × locally recorded model and cache mix.');
                row.add_child(estimate);
            }
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
                : 'account token total unavailable'}` +
            `${cost === null ? '' : `, estimated API-equivalent cost ${formatCost(cost)}`}`;
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

    box.accessible_name = 'Token totals from your Codex account. Approximate USD values use the locally recorded model and cache mix.';
    return box;
}

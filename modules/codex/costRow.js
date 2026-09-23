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
        const amount = Number.isSafeInteger(period.tokens)
            ? `${cost === null ? '—' : `≈${formatCost(cost)}`} · ${tokensFormatter.format(period.tokens)} tokens`
            : period.title.startsWith('Today') && accountUsage ? 'Not reported yet' : '—';
        const value = new St.Label({text: amount, style_class: 'shadow-cost-amount'});
        row.add_child(value);
        row.accessible_name = `${period.title}: ${Number.isSafeInteger(period.tokens)
            ? `${tokensFormatter.format(period.tokens)} account tokens`
            : period.title.startsWith('Today') && accountUsage
                ? 'Codex account has not reported this date yet'
                : 'account token total unavailable'}` +
            `${cost === null ? '' : `, estimated API-equivalent cost ${formatCost(cost)}`}`;
        value.accessible_name = row.accessible_name;
        box.add_child(row);
    }

    const latestDate = accountUsage?.latestReportedDate ?? accountUsage?.dailyBuckets?.at(-1)?.date ?? null;
    if (!accountUsage) {
        const note = new St.Label({
            text: 'Waiting for Codex account token data. Local session totals are not substituted.',
            style_class: 'shadow-cost-note shadow-muted', x_expand: true,
        });
        note.clutter_text.set_line_wrap(true);
        box.add_child(note);
    } else if (!Number.isSafeInteger(todayTokens)) {
        const latest = latestDate ? ` Latest account date returned: ${formatDate(latestDate)}.` : '';
        const note = new St.Label({
            text: `Codex has not returned an account bucket for ${formatDate(todayDate)} yet.${latest} Daily account data may arrive later; no local session totals are substituted.`,
            style_class: 'shadow-cost-note shadow-muted', x_expand: true,
        });
        note.clutter_text.set_line_wrap(true);
        note.accessible_name = note.text;
        box.add_child(note);
    }

    box.accessible_name = 'Exact Codex account token totals with approximate API-equivalent cost';
    attachTooltip(box, () => {
        if (!accountUsage)
            return 'Account token totals are unavailable. Refresh Codex usage to load them.';
        const updated = Number.isFinite(accountUsage.updatedAt)
            ? `Account response read ${new Date(accountUsage.updatedAt).toLocaleString()}.\n`
            : '';
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'device local time';
        const latest = latestDate ? `Latest account date returned: ${latestDate}.\n` : '';
        const todayNote = Number.isSafeInteger(todayTokens) ? ''
            : `No account bucket for ${todayDate}; today's account total is not reported yet.\n`;
        const models = usage?.models?.map(model =>
            `${model.model}: ${model.priced ? formatCost(model.cost) : 'Unpriced'}`).join('\n') ?? '';
        return `${updated}${latest}${todayNote}` +
            'Token totals come from the Codex account usage response. Its daily buckets contain date-only startDate values, but the response does not provide a timezone or day-boundary rule; the panel preserves those dates and compares them with the device calendar.' +
            ` Device time zone: ${timezone}.\n` +
            'USD is a standard API-equivalent estimate: it applies the locally recorded, priced model/cache mix to the exact account token totals. Fast-mode premiums and tool-call fees are excluded; it is not a Codex or ChatGPT subscription charge.\n' +
            `${usage?.partial ? 'Some local token records or models are unpriced, so the estimate extrapolates from the priced session mix.' : 'Local session pricing data is complete for recognized models.'}` +
            `${usage?.stale ? '\nThe local model/cache scan is using its last available result.' : ''}` +
            `${models ? `\n\nLocal session models\n${models}` : ''}` +
            `\nPrices checked ${usage?.priceDate ?? '—'} · USD. Allowance percentages are separate from token totals.`;
    });
    return box;
}

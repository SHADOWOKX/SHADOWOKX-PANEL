import Clutter from 'gi://Clutter';
import St from 'gi://St';
import {attachTooltip} from '../../ui/components.js';
import {formatCost} from './cost.js';

const tokensFormatter = new Intl.NumberFormat('en-US', {maximumFractionDigits: 0});

function accountTokensForDate(accountUsage, date) {
    if (!date)
        return null;
    if (date === accountUsage?.today && Number.isSafeInteger(accountUsage?.todayTokens))
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
    const today = localDays.at(-1);
    const yesterday = localDays.at(-2);
    const week = localDays.slice(-7);
    const periods = [
        ['Today', accountTokensForDate(accountUsage, today?.date), today?.cost, today?.pricedTokens],
        ['Yesterday', accountTokensForDate(accountUsage, yesterday?.date), yesterday?.cost, yesterday?.pricedTokens],
        ['Last 7 Days', accountUsage?.sevenDayTokens,
            localTotal(week, 'cost'), localTotal(week, 'pricedTokens')],
    ];
    for (const [title, tokens, localCost, pricedTokens] of periods) {
        const row = new St.BoxLayout({style_class: 'shadow-cost-period', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        row.add_child(new St.Label({text: title, style_class: 'shadow-muted', x_expand: true}));
        const cost = usage?.available
            ? estimateAccountCost(tokens, localCost, pricedTokens) : null;
        const amount = Number.isSafeInteger(tokens)
            ? `${cost === null ? '—' : `≈${formatCost(cost)}`} · ${tokensFormatter.format(tokens)} tokens`
            : '—';
        const value = new St.Label({text: amount, style_class: 'shadow-cost-amount'});
        row.add_child(value);
        row.accessible_name = `${title}: ${Number.isSafeInteger(tokens)
            ? `${tokensFormatter.format(tokens)} account tokens` : 'account token total unavailable'}` +
            `${cost === null ? '' : `, estimated API-equivalent cost ${formatCost(cost)}`}`;
        value.accessible_name = row.accessible_name;
        box.add_child(row);
    }
    box.accessible_name = 'Exact Codex account token totals with approximate API-equivalent cost';
    attachTooltip(box, () => {
        if (!accountUsage)
            return 'Account token totals are unavailable. Refresh Codex usage to load them.';
        const updated = Number.isFinite(accountUsage.updatedAt)
            ? `Account totals last refreshed ${new Date(accountUsage.updatedAt).toLocaleString()}.\n`
            : '';
        const models = usage?.models?.map(model =>
            `${model.model}: ${model.priced ? formatCost(model.cost) : 'Unpriced'}`).join('\n') ?? '';
        return `${updated}Token totals come from the Codex account usage response.\n` +
            'USD is a standard API-equivalent estimate: it applies the locally recorded, priced model/cache mix to the exact account token totals. Fast-mode premiums and tool-call fees are excluded; it is not a Codex or ChatGPT subscription charge.\n' +
            `${usage?.partial ? 'Some local token records or models are unpriced, so the estimate extrapolates from the priced session mix.' : 'Local session pricing data is complete for recognized models.'}` +
            `${usage?.stale ? '\nThe local model/cache scan is using its last available result.' : ''}` +
            `${models ? `\n\nLocal session models\n${models}` : ''}` +
            `\nPrices checked ${usage?.priceDate ?? '—'} · USD. Allowance percentages are separate from token totals.`;
    });
    return box;
}

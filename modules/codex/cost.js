import {localUsageDateKey} from './normalize.js';

// Standard USD / million tokens: input, cached input, output, cache write.
// Official OpenAI model pages, checked 2026-09-23.
// https://developers.openai.com/api/docs/models/{model}
export const PRICE_DATE = '2026-09-23';
export const PRICES = Object.freeze({
    'gpt-6-astra': [10, 1, 50, 12.5],
    'gpt-6-sol': [2, 0.2, 10, 2.5],
    'gpt-6-luna': [0.1, 0.01, 0.5, 0.125],
    'gpt-5.6-sol': [4, 0.4, 20, 5],
    'gpt-5.6': [4, 0.4, 20, 5],
    'gpt-5.6-terra': [2, 0.2, 12, 2.5],
    'gpt-5.6-luna': [0.2, 0.02, 1.2, 0.25],
    // OpenAI documents this alias as routing to gpt-5.6-sol.
    'gpt-daybreak-blue-latest': [4, 0.4, 20, 5],
});

export function formatCost(value) {
    if (!Number.isFinite(value) || value < 0)
        return '—';
    if (value > 0 && value < 0.01)
        return '<$0.01';
    return `$${value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}

export function estimateTokens(model, usage) {
    const counts = ['input_tokens', 'cached_input_tokens', 'output_tokens']
        .map(key => usage?.[key]);
    const writes = usage?.cache_write_input_tokens ?? 0;
    if (![...counts, writes].every(n => Number.isSafeInteger(n) && n >= 0))
        return null;
    const [input, cached, output] = counts;
    if (cached + writes > input)
        return null;
    const uncached = input - cached - writes;
    const rate = PRICES[model];
    const tokens = usage.total_tokens ?? input + output;
    if (!Number.isSafeInteger(tokens) || tokens < 0 || tokens !== input + output)
        return null;
    const long = input > 272000;
    const inputMultiplier = long ? 2 : 1;
    const cacheMultiplier = long ? 2 : 1;
    const outputMultiplier = long ? 1.5 : 1;
    return {
        input, cached, output, writes, uncached, tokens,
        cost: rate ? (uncached * rate[0] * inputMultiplier +
            cached * rate[1] * cacheMultiplier + writes * rate[3] * inputMultiplier +
            output * rate[2] * outputMultiplier) / 1e6 : null,
        savings: rate ? cached * (rate[0] * inputMultiplier - rate[1] * cacheMultiplier) / 1e6 : 0,
    };
}

// Only usage metadata leaves the worker; conversation text is never retained.
export function sessionCostParser() {
    let model = 'unknown';
    let provider = 'openai';
    let previous = null;
    const records = [];
    return {
        records,
        accept(record) {
            if (record.type === 'session_meta')
                provider = record.payload?.model_provider ?? 'openai';
            if (record.type === 'turn_context')
                model = record.payload?.model ?? 'unknown';
            if (record.type !== 'event_msg' || record.payload?.type !== 'token_count')
                return;
            const info = record.payload.info;
            const total = info?.total_token_usage;
            if (!total)
                return;
            const signature = JSON.stringify([total.input_tokens, total.cached_input_tokens,
                total.output_tokens, total.cache_write_input_tokens ?? 0, total.total_tokens]);
            if (previous === signature)
                return;
            previous = signature;
            const usage = info.last_token_usage;
            if (!usage || !Number.isFinite(Date.parse(record.timestamp)))
                return;
            records.push({model: provider === 'openai' ? model : `${provider}/${model}`,
                timestamp: record.timestamp, usage,
                // Forks replay the original timestamp and counters. Do not bill twice.
                key: JSON.stringify([record.timestamp, record.ordinal ?? null, model,
                    signature, usage])});
        },
    };
}

export function summarizeCosts(records, nowMs = Date.now()) {
    const today = localUsageDateKey(nowMs);
    const end = Date.parse(`${today}T00:00:00Z`);
    const days = Array.from({length: 30}, (_, i) => ({
        date: new Date(end - (29 - i) * 86400000).toISOString().slice(0, 10), cost: 0, tokens: 0, unknownTokens: 0,
    }));
    const byDay = new Map(days.map(day => [day.date, day]));
    const models = new Map();
    const seen = new Set();
    const summary = {cost: 0, cached: 0, uncached: 0, output: 0, tokens: 0, pricedTokens: 0,
        savings: 0, unknownTokens: 0, invalidRecords: 0, records: 0, days, models: [],
        today, priceDate: PRICE_DATE, updatedAt: nowMs};
    for (const record of records) {
        const date = localUsageDateKey(Date.parse(record.timestamp));
        if (!byDay.has(date) || seen.has(record.key))
            continue;
        seen.add(record.key);
        const value = estimateTokens(record.model, record.usage);
        if (!value) {
            summary.invalidRecords++;
            continue;
        }
        if (value.tokens === 0)
            continue;
        const row = models.get(record.model) ?? {model: record.model, tokens: 0, cost: 0,
            priced: value.cost !== null};
        row.tokens += value.tokens;
        row.cost += value.cost ?? 0;
        models.set(record.model, row);
        summary.records++;
        for (const key of ['cached', 'uncached', 'output', 'tokens', 'savings'])
            summary[key] += value[key];
        byDay.get(date).tokens += value.tokens;
        if (value.cost === null) {
            summary.unknownTokens += value.tokens;
            byDay.get(date).unknownTokens += value.tokens;
        }
        else {
            summary.cost += value.cost;
            byDay.get(date).cost += value.cost;
            summary.pricedTokens += value.tokens;
            byDay.get(date).pricedTokens = (byDay.get(date).pricedTokens ?? 0) + value.tokens;
        }
    }
    summary.models = [...models.values()].sort((a, b) => b.cost - a.cost);
    summary.todayCost = days.at(-1).cost;
    summary.todayTokens = days.at(-1).tokens;
    summary.yesterdayCost = days.at(-2).cost;
    summary.yesterdayTokens = days.at(-2).tokens;
    summary.partial = summary.unknownTokens > 0 || summary.invalidRecords > 0;
    return summary;
}

const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = value => typeof value === 'string' ? value.slice(0, 160) : null;

function timestamp(value) {
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    const n = number(value);
    return n !== null && n > 0 ? (n < 1e12 ? n * 1000 : n) : null;
}

export function usageTaskActive(data, now = Date.now()) {
    const activity = data?.activity;
    return activity?.active === true && Number.isFinite(activity.updatedAt) &&
        activity.updatedAt <= now + 5000 && Number.isFinite(activity.expiresAt) && activity.expiresAt > now;
}

export function normalizeUsage(raw, id, now = Date.now()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('Usage source must contain a JSON object.');
    const windows = [];
    const add = (label, value) => {
        if (!value || typeof value !== 'object')
            return;
        let used = number(value.usedPercent ?? value.used_percentage ?? value.utilization);
        const remaining = number(value.remainingPercent);
        if (used === null && remaining !== null)
            used = 100 - remaining;
        if (used === null)
            return;
        const resetsAt = timestamp(value.resetsAt ?? value.resets_at);
        // An expired snapshot does not describe the new allowance.
        if (resetsAt !== null && resetsAt <= now)
            return;
        windows.push({label: text(label) ?? 'Allowance',
            usedPercent: Math.max(0, Math.min(100, used)), resetsAt});
    };
    if (Array.isArray(raw.windows))
        raw.windows.slice(0, 12).forEach(w => add(w?.label, w));
    else {
        const rate = raw.rate_limits ?? raw;
        add('Five-hour allowance', rate.five_hour ?? rate.fiveHour);
        add('Weekly allowance', rate.seven_day ?? rate.weekly);
        add('Monthly allowance', rate.monthly);
        add('Spend allowance', rate.spend_limit);
    }
    const balances = [];
    if (id === 'deepseek' && Array.isArray(raw.balance_infos)) {
        for (const b of raw.balance_infos.slice(0, 8)) {
            const amount = typeof b.total_balance === 'string' && b.total_balance.trim()
                ? Number(b.total_balance) : number(b.total_balance);
            if (Number.isFinite(amount))
                balances.push({amount, currency: text(b.currency) ?? ''});
        }
    } else if (number(raw.balance?.amount) !== null) {
        balances.push({amount: raw.balance.amount, currency: text(raw.balance.currency) ?? ''});
    }
    const tokens = number(raw.tokens?.total ?? raw.totalTokens);
    if (!windows.length && !balances.length && tokens === null)
        throw new Error('No allowance, balance or token usage was reported by this source.');
    const activityAt = timestamp(raw.activity?.updatedAt ?? raw.updatedAt);
    const activity = typeof raw.activity?.active === 'boolean' && activityAt !== null ? {
        active: raw.activity.active, updatedAt: activityAt,
        expiresAt: Math.min(timestamp(raw.activity.expiresAt) ?? activityAt + 30000, activityAt + 120000),
    } : null;
    return {activity, windows, balances, tokens: tokens !== null && tokens >= 0 ? tokens : null,
        plan: text(raw.plan), account: text(raw.account),
        updatedAt: timestamp(raw.updatedAt) ?? now};
}

export function sourceConfig(settings, id) {
    try {
        const sources = JSON.parse(settings.get_string('ai-sources'));
        const value = sources?.[id];
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
}

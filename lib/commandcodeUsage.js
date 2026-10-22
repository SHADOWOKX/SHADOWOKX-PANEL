// Only fields documented by the supplied reference and verified response shapes.
// No plan-to-credit table: an advertised cap is not this account's allowance.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const text = value => typeof value === 'string' && value.length <= 160 ? value : null;

export class CommandCodeError extends Error {
    constructor(code, retryAt = 0) {
        super(({
            'authentication-required': 'Add your Command Code API key in Settings.',
            'authentication-failed': 'Command Code rejected the API key. Update it in Settings.',
            'keyring-locked': 'Unlock your GNOME keyring, then refresh Command Code.',
            'keyring-unavailable': 'GNOME Secret Service is unavailable. No plaintext credential fallback is used.',
            'keyring-write-failed': 'The API key could not be saved in GNOME Secret Service.',
            'invalid-key': 'Enter a valid API key without spaces.',
            'rate-limited': 'Command Code rate limit reached. Refresh will resume after the server retry time.',
            'network': 'Could not reach Command Code. The last successful values are marked stale.',
            'timeout': 'Command Code did not respond in time. Refresh will retry automatically.',
            'server': 'Command Code is temporarily unavailable. Refresh will retry automatically.',
            'api-changed': 'Command Code returned an unsupported usage response. Missing values are unavailable.',
            'cancelled': 'Command Code refresh was cancelled.',
        })[code] ?? 'Command Code usage is unavailable.');
        this.code = code;
        this.retryAt = retryAt;
    }
}

export function validateCommandCodeKey(key) {
    if (typeof key !== 'string' || !/^[\x21-\x7e]{8,4096}$/.test(key))
        throw new CommandCodeError('invalid-key');
    return key;
}

export function decodeCommandCodeResponse(bytes) {
    if (bytes.length > 1024 * 1024) throw new CommandCodeError('api-changed');
    try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
    catch { throw new CommandCodeError('api-changed'); }
}

export function commandCodeTimestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        const ms = value < 1e12 ? value * 1000 : value;
        return Number.isFinite(new Date(ms).getTime()) ? ms : null;
    }
    if (typeof value === 'string' && value.trim()) {
        const ms = Date.parse(value);
        return Number.isFinite(ms) && ms > 0 ? ms : null;
    }
    return null;
}

export function retryAfterTime(value, now = Date.now()) {
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        const retry = now + Math.max(1, Number(value)) * 1000;
        return Number.isFinite(new Date(retry).getTime()) ? retry : now + 180000;
    }
    const date = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(date) && date > now ? date : now + 180000;
}

export function commandCodeIdentity(raw) {
    const root = record(raw?.data) && record(raw.data.user) ? raw.data : raw;
    if (!record(root?.user) || raw?.success === false) throw new CommandCodeError('api-changed');
    return {account: text(root.user.userName ?? root.user.username), orgId: text(root.org?.id)};
}

export function parseCommandCodeUsage(whoami, creditsResponse, subscriptionResponse = null,
    summaryResponse = null, now = Date.now()) {
    const identity = commandCodeIdentity(whoami);
    const root = record(creditsResponse?.data) ? creditsResponse.data : creditsResponse;
    if (!record(root) || creditsResponse?.success === false || (!record(root.credits) && !record(root.windowLimits)))
        throw new CommandCodeError('api-changed');
    const credits = root.credits ?? {};
    const limits = root.windowLimits ?? {};
    const subscription = record(subscriptionResponse?.data) ? subscriptionResponse.data
        : record(subscriptionResponse?.subscription) ? subscriptionResponse.subscription : {};
    const summary = record(summaryResponse?.data) ? summaryResponse.data
        : record(summaryResponse) ? summaryResponse : {};
    const windows = [];
    for (const [label, raw] of [['Five-hour allowance', limits.fiveHour ?? limits.five_hour],
        ['Weekly allowance', limits.weekly]]) {
        if (!record(raw)) continue;
        const used = amount(raw.used), cap = amount(raw.cap);
        if (used === null || cap === null) continue; // Missing never means zero.
        const resetsAt = commandCodeTimestamp(raw.resetAt ?? raw.reset_at);
        if (resetsAt !== null && resetsAt <= now) continue;
        const percent = cap > 0 ? used / cap * 100 : null;
        windows.push({label, used, cap, usedPercent: Number.isFinite(percent) ? percent : null,
            exceeded: typeof raw.exceeded === 'boolean' ? raw.exceeded : null, resetsAt});
    }
    const planId = text(subscription.planId ?? subscription.plan_id ?? credits.planId ?? credits.plan_id);
    const plan = planId === 'individual-goat' ? 'GOAT' : planId;
    const creditBalances = [];
    for (const [label, value] of [['Monthly credits remaining', credits.monthlyCredits ?? credits.monthly_credits],
        ['Purchased credits', credits.purchasedCredits ?? credits.purchased_credits],
        ['Free credits', credits.freeCredits ?? credits.free_credits]]) {
        if (amount(value) !== null) creditBalances.push({label, amount: value});
    }
    if (!windows.length && !creditBalances.length) throw new CommandCodeError('api-changed');
    const periodStart = commandCodeTimestamp(subscription.currentPeriodStart ?? subscription.current_period_start);
    const periodEnd = commandCodeTimestamp(subscription.currentPeriodEnd ?? subscription.current_period_end);
    const periodBasis = text(summary.periodBasis);
    // totalCredits is the returned aggregate, not cap - remaining or inference tokens.
    const consumption = {usedCredits: amount(summary.totalCredits), monthlyUsedCredits: amount(summary.totalMonthlyCredits),
        purchasedUsedCredits: amount(summary.totalPurchasedCredits), freeUsedCredits: amount(summary.totalFreeCredits),
        requests: count(summary.totalCount),
        periodBasis, periodStart, periodEnd};
    return {source: 'commandcode-api', activity: null, plan, planId, account: identity.account,
        planStatus: text(subscription.status), windows, creditBalances, consumption,
        balances: [], tokens: null, updatedAt: now, warnings: []};
}

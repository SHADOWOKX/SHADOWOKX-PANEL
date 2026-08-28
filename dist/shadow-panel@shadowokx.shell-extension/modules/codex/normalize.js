import {clampPercent} from '../../lib/format.js';

function cleanText(value, maximum = 120) {
    if (typeof value !== 'string')
        return '';
    const clean = value
        .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
        .trim();
    return [...clean].slice(0, maximum).join('');
}

function normalizeTimestamp(value) {
    if (!Number.isFinite(value) || value <= 0)
        return null;
    const timestamp = Math.round(value);
    return Number.isFinite(new Date(timestamp * 1000).getTime()) ? timestamp : null;
}

function normalizeWindow(window) {
    if (!window || !Number.isFinite(window.usedPercent))
        return null;
    const usedPercent = clampPercent(window.usedPercent);
    return {
        usedPercent,
        remainingPercent: 100 - usedPercent,
        resetsAt: normalizeTimestamp(window.resetsAt),
        windowDurationMins: Number.isFinite(window.windowDurationMins)
            ? window.windowDurationMins
            : null,
    };
}

function isFiveHour(window) {
    return window?.windowDurationMins >= 240 && window.windowDurationMins <= 360;
}

function isWeekly(window) {
    return window?.windowDurationMins >= 6 * 24 * 60 &&
        window.windowDurationMins <= 8 * 24 * 60;
}

export function accountNameFromEmail(email) {
    const cleanEmail = cleanText(email, 254);
    if (!cleanEmail)
        return null;
    const localPart = cleanEmail.split('@', 1)[0].trim();
    return localPart ? [...localPart].slice(0, 80).join('') : null;
}

export function planLabel(planType) {
    const labels = {
        free: 'Codex Free',
        go: 'Codex Go',
        plus: 'Codex Plus',
        pro: 'Codex Pro',
        prolite: 'Codex Pro',
        team: 'Codex Team',
        self_serve_business_prolite: 'Codex Business',
        self_serve_business_usage_based: 'Codex Business',
        business: 'Codex Business',
        ent26: 'Codex Enterprise',
        enterprise_cbp_automation: 'Codex Enterprise',
        enterprise_cbp_usage_based: 'Codex Enterprise',
        enterprise: 'Codex Enterprise',
        edu: 'Codex Edu',
        edu_plus: 'Codex Edu Plus',
        edu_pro: 'Codex Edu Pro',
    };
    return Object.hasOwn(labels, planType)
        ? labels[planType]
        : planType ? 'Codex account' : null;
}

function clientVersion(userAgent) {
    const match = cleanText(userAgent, 200).match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
    return match?.[0] ?? null;
}

function normalizeCredits(credits) {
    if (!credits || typeof credits !== 'object')
        return null;
    return {
        hasCredits: Boolean(credits.hasCredits),
        unlimited: Boolean(credits.unlimited),
        balance: cleanText(credits.balance, 48) || null,
    };
}

function normalizeSpendControl(limit) {
    if (!limit || typeof limit !== 'object')
        return null;
    return {
        limit: cleanText(limit.limit, 48) || null,
        used: cleanText(limit.used, 48) || null,
        remainingPercent: Number.isFinite(limit.remainingPercent)
            ? clampPercent(limit.remainingPercent)
            : null,
        resetsAt: normalizeTimestamp(limit.resetsAt),
    };
}

export function normalizeRateLimits(response, nowMs = Date.now(), metadata = {}) {
    if (!response || typeof response !== 'object')
        throw new Error('Codex returned an invalid rate-limit response');

    const snapshot = response.rateLimitsByLimitId?.codex ?? response.rateLimits;
    if (!snapshot || typeof snapshot !== 'object')
        throw new Error('Codex did not return a Codex rate-limit bucket');

    const windows = [snapshot.primary, snapshot.secondary]
        .map(normalizeWindow)
        .filter(Boolean);
    const fiveHour = windows.find(isFiveHour) ?? null;
    const weekly = windows.find(isWeekly) ?? null;
    const account = metadata.accountResponse?.account ?? metadata.account ?? null;
    const resolvedPlanType = cleanText(account?.planType ?? snapshot.planType, 80) || null;
    const resetCreditDetails = Array.isArray(response.rateLimitResetCredits?.credits)
        ? response.rateLimitResetCredits.credits
            .filter(credit => credit?.status === 'available')
            .map(credit => ({
                title: cleanText(credit.title, 80) || 'Rate-limit reset',
                expiresAt: normalizeTimestamp(credit.expiresAt),
            }))
        : null;

    return {
        status: 'success',
        connection: 'connected',
        stale: false,
        error: null,
        source: 'codex-app-server',
        accountName: accountNameFromEmail(account?.email),
        accountType: cleanText(account?.type, 40) || null,
        planType: resolvedPlanType,
        planLabel: planLabel(resolvedPlanType),
        clientVersion: clientVersion(metadata.initializeResponse?.userAgent),
        limitReachedType: cleanText(snapshot.rateLimitReachedType, 80) || null,
        fiveHour,
        weekly,
        unclassifiedWindows: windows.filter(window => !isFiveHour(window) && !isWeekly(window)),
        extraUsage: normalizeCredits(snapshot.credits),
        spendControl: normalizeSpendControl(snapshot.individualLimit),
        resetCreditsAvailable: Number.isFinite(response.rateLimitResetCredits?.availableCount)
            ? Math.max(0, Math.min(999, Math.round(response.rateLimitResetCredits.availableCount)))
            : 0,
        resetCreditDetails,
        lastSuccessfulRefresh: nowMs,
    };
}

export function normalizeCachedRateLimits(value) {
    if (!value || typeof value !== 'object' || !Number.isFinite(value.lastSuccessfulRefresh) ||
        value.lastSuccessfulRefresh <= 0 || value.lastSuccessfulRefresh > Date.now() + 5 * 60 * 1000)
        return null;
    const fiveHour = normalizeWindow(value.fiveHour);
    const weekly = normalizeWindow(value.weekly);
    if (!fiveHour && !weekly)
        return null;
    const cachedPlanType = cleanText(value.planType, 80) || null;
    return {
        status: 'cached',
        connection: 'connected',
        stale: false,
        error: null,
        source: 'codex-app-server',
        accountName: cleanText(value.accountName, 80) || null,
        accountType: cleanText(value.accountType, 40) || null,
        planType: cachedPlanType,
        planLabel: cleanText(value.planLabel, 80) || planLabel(cachedPlanType),
        clientVersion: cleanText(value.clientVersion, 80) || null,
        fiveHour,
        weekly,
        resetCreditsAvailable: Number.isFinite(value.resetCreditsAvailable)
            ? Math.max(0, Math.min(999, Math.round(value.resetCreditsAvailable)))
            : 0,
        lastSuccessfulRefresh: value.lastSuccessfulRefresh,
    };
}

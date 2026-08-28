export function clampPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number))
        return 0;
    return Math.max(0, Math.min(100, Math.round(number)));
}

export function formatCountdown(unixSeconds, nowMs = Date.now()) {
    const resetDate = new Date(unixSeconds * 1000);
    if (!Number.isFinite(unixSeconds) || !Number.isFinite(resetDate.getTime()))
        return 'Reset time unavailable';

    const remaining = Math.max(0, Math.round(unixSeconds - nowMs / 1000));
    if (remaining === 0)
        return 'Reset due now';

    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    if (days > 0)
        return `Resets in ${days}d ${hours}h`;
    if (hours > 0)
        return `Resets in ${hours}h ${minutes}m`;
    return `Resets in ${Math.max(1, minutes)}m`;
}

export function formatResetDate(unixSeconds) {
    const date = new Date(unixSeconds * 1000);
    if (!Number.isFinite(unixSeconds) || !Number.isFinite(date.getTime()))
        return 'Reset time unavailable';
    return date.toLocaleString([], {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
    });
}

export function formatClock(unixMs) {
    const date = new Date(unixMs);
    if (!Number.isFinite(unixMs) || !Number.isFinite(date.getTime()))
        return 'Never';
    return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

export function isHexColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(value ?? '');
}

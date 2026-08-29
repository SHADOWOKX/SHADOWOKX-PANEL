export function codexRemainingSummary(state) {
    const window = state?.weekly ?? state?.fiveHour;
    return Number.isFinite(window?.remainingPercent)
        ? Math.max(0, Math.min(100, Math.round(window.remainingPercent)))
        : null;
}

export function codexUsageStatus(remainingPercent) {
    if (!Number.isFinite(remainingPercent))
        return null;
    const remaining = Math.max(0, Math.min(100, Math.round(remainingPercent)));
    if (remaining >= 60)
        return {emoji: '🟢', label: 'Comfortable'};
    if (remaining >= 30)
        return {emoji: '🟡', label: 'Steady'};
    if (remaining >= 15)
        return {emoji: '🟠', label: 'Limited'};
    return {emoji: '🔴', label: 'Low'};
}

export function weatherSummaryTemperature(state) {
    return Number.isFinite(state?.current?.temperature)
        ? Math.round(state.current.temperature)
        : null;
}

export function codexRemainingSummary(state) {
    const window = state?.weekly ?? state?.fiveHour;
    return Number.isFinite(window?.remainingPercent)
        ? Math.max(0, Math.min(100, Math.round(window.remainingPercent)))
        : null;
}

export function weatherSummaryTemperature(state) {
    return Number.isFinite(state?.current?.temperature)
        ? Math.round(state.current.temperature)
        : null;
}

export function chooseInitialModule(visibleIds, remember, last, fallback) {
    if (visibleIds.length === 0)
        return null;
    if (remember && visibleIds.includes(last))
        return last;
    if (visibleIds.includes(fallback))
        return fallback;
    return visibleIds[0];
}

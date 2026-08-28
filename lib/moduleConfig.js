import {MODULE_IDS} from './constants.js';

export function canonicalizeModuleSettings(order, enabled, available = MODULE_IDS) {
    const allowed = new Set(available);
    const canonicalOrder = [];
    for (const id of Array.isArray(order) ? order : []) {
        if (allowed.has(id) && !canonicalOrder.includes(id))
            canonicalOrder.push(id);
    }
    for (const id of available) {
        if (!canonicalOrder.includes(id))
            canonicalOrder.push(id);
    }
    const canonicalEnabled = [];
    for (const id of Array.isArray(enabled) ? enabled : []) {
        if (allowed.has(id) && !canonicalEnabled.includes(id))
            canonicalEnabled.push(id);
    }
    if (Array.isArray(enabled) && enabled.length > 0 && canonicalEnabled.length === 0)
        canonicalEnabled.push(...available);
    return {order: canonicalOrder, enabled: canonicalEnabled};
}

export function resolveModuleOrder(order, enabled, available = MODULE_IDS) {
    const allowed = new Set(available);
    const enabledSet = new Set(enabled.filter(id => allowed.has(id)));
    const result = [];

    for (const id of order) {
        if (enabledSet.has(id) && !result.includes(id))
            result.push(id);
    }

    for (const id of available) {
        if (enabledSet.has(id) && !result.includes(id))
            result.push(id);
    }

    return result;
}

export function chooseInitialModule(visibleIds, remember, last, fallback) {
    if (visibleIds.length === 0)
        return null;
    if (remember && visibleIds.includes(last))
        return last;
    if (visibleIds.includes(fallback))
        return fallback;
    return visibleIds[0];
}

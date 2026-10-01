import {AI_IDS} from './constants.js';

export function visibleModules(settings) {
    const added = settings.get_strv('ai-providers');
    const hidden = settings.get_strv('hidden-ai-providers');
    const ids = [...new Set(added)].filter(id => AI_IDS.includes(id) && !hidden.includes(id));
    if (settings.get_boolean('show-weather-panel'))
        ids.push('weather');
    return ids;
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

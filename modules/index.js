import {AI_IDS} from '../lib/constants.js';
import {AIPage} from './ai/page.js';
import {CodexPage} from './codex/page.js';
import {WeatherPage} from './weather/page.js';

export const PAGE_FACTORIES = Object.freeze({
    ...Object.fromEntries(AI_IDS.filter(id => id !== 'codex').map(id =>
        [id, context => new AIPage(context, id)])),
    codex: context => new CodexPage(context),
    weather: context => new WeatherPage(context),
});

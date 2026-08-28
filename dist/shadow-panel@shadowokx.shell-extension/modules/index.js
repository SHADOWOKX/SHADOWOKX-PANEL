import {CodexPage} from './codex/page.js';
import {NotesPage} from './notes/page.js';
import {WeatherPage} from './weather/page.js';

export const PAGE_FACTORIES = Object.freeze({
    codex: context => new CodexPage(context),
    weather: context => new WeatherPage(context),
    notes: context => new NotesPage(context),
});

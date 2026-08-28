import System from 'system';

import {WeatherProvider} from '../modules/weather/provider.js';

const values = {
    'weather-refresh-minutes': 30,
    'weather-location': 'Cairo, Egypt',
    'weather-unit': 'celsius',
};

const settings = {
    get_int(key) {
        return values[key] ?? 30;
    },
    get_string(key) {
        return values[key] ?? '';
    },
    connect() {
        return 1;
    },
    disconnect() {},
};

const scheduler = {
    every() {},
    cancel() {},
};

const provider = new WeatherProvider(settings, scheduler, null);
const state = await provider.start();
print(JSON.stringify({
    status: state.status,
    location: state.location ?? null,
    unit: state.unit ?? null,
    currentAvailable: Boolean(state.current),
    forecastHours: state.forecast?.length ?? 0,
    error: state.error ?? null,
}, null, 2));
provider.destroy();

if (!state.current)
    System.exit(1);

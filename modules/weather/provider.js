import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {APP_VERSION} from '../../lib/constants.js';
import {Observable} from '../../services/observable.js';
import {JsonStore} from '../../services/jsonStore.js';
import {
    normalizeWeather,
    normalizeWeatherQuery,
    weatherCacheMatchesSettings,
} from './normalize.js';

Gio._promisify(Soup.Session.prototype, 'send_async', 'send_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');
Gio._promisify(Gio.InputStream.prototype, 'close_async', 'close_finish');

const MAX_RESPONSE_BYTES = 1024 * 1024;

export class WeatherProvider extends Observable {
    constructor(settings, scheduler, logger) {
        super({status: 'loading', stale: false, error: null, lastSuccessfulRefresh: null});
        this._settings = settings;
        this._scheduler = scheduler;
        this._logger = logger;
        this._session = new Soup.Session({timeout: 15, user_agent: `Shadow Panel/${APP_VERSION}`});
        this._cache = new JsonStore(
            GLib.build_filenamev([GLib.get_user_cache_dir(), 'shadow-panel']),
            'weather.json',
            logger
        );
        this._cancellable = null;
        this._inFlight = null;
        this._settingsIds = [];
        this._resolvedLocation = null;
        this._pendingRefresh = false;
        this._settingsRefreshId = 0;
        this._locationChanged = false;
        this._destroyed = false;
    }

    async start() {
        const cached = await this._cache.read(null);
        if (this._destroyed)
            return this.getState();
        const query = this._locationQuery();
        const unit = this._unit();
        if (weatherCacheMatchesSettings(cached, query, unit)) {
            this._resolvedLocation = cached.resolvedLocation;
            const stale = Date.now() - cached.state.lastSuccessfulRefresh >=
                this._settings.get_int('weather-refresh-minutes') * 60 * 1000;
            this._setState({...cached.state, status: stale ? 'stale' : 'cached', stale, error: null});
        }
        this._reschedule();
        this._settingsIds.push(
            this._settings.connect('changed::weather-refresh-minutes', () => {
                this._reschedule();
                this.refresh(false);
            }),
            this._settings.connect('changed::weather-location', () =>
                this._queueSettingsRefresh(true)),
            this._settings.connect('changed::weather-unit', () =>
                this._queueSettingsRefresh(false))
        );
        return this.refresh(false);
    }

    _reschedule() {
        this._scheduler.every(
            'weather-refresh',
            this._settings.get_int('weather-refresh-minutes') * 60,
            () => this.refresh(false)
        );
    }

    refresh(force = true) {
        if (this._destroyed)
            return Promise.resolve(this.getState());
        if (this._inFlight)
            return this._inFlight;
        if (!force && !this.isStale())
            return Promise.resolve(this.getState());
        this._inFlight = this._refresh().finally(() => {
            this._inFlight = null;
            if (this._pendingRefresh && !this._destroyed) {
                this._pendingRefresh = false;
                this.refresh(true);
            }
        });
        return this._inFlight;
    }

    _queueSettingsRefresh(locationChanged) {
        this._locationChanged ||= locationChanged;
        if (this._settingsRefreshId)
            GLib.Source.remove(this._settingsRefreshId);
        this._settingsRefreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 450, () => {
            this._settingsRefreshId = 0;
            if (this._destroyed)
                return GLib.SOURCE_REMOVE;
            if (this._locationChanged)
                this._resolvedLocation = null;
            this._locationChanged = false;
            if (this._inFlight) {
                this._pendingRefresh = true;
                this._cancellable?.cancel();
            } else {
                this.refresh(true);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _locationQuery() {
        return normalizeWeatherQuery(this._settings.get_string('weather-location'));
    }

    _unit() {
        return this._settings.get_string('weather-unit') === 'fahrenheit'
            ? 'fahrenheit'
            : 'celsius';
    }

    isStale() {
        const current = this.getState();
        if (current?.status === 'stale' || current?.status === 'error')
            return true;
        const last = current?.lastSuccessfulRefresh;
        const maxAge = this._settings.get_int('weather-refresh-minutes') * 60 * 1000;
        return !last || Date.now() - last >= maxAge;
    }

    async _refresh() {
        const previous = this.getState();
        this._setState({
            ...previous,
            status: previous?.lastSuccessfulRefresh ? 'refreshing' : 'loading',
            error: null,
        });

        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        try {
            const query = this._locationQuery();
            const unit = this._unit();
            const resolved = await this._resolveLocation(query, cancellable);
            const payload = await this._fetchForecast(resolved, unit, cancellable);
            const state = normalizeWeather(payload, resolved.displayName, unit);
            if (this._destroyed || query !== this._locationQuery() || unit !== this._unit())
                return this.getState();
            this._setState(state);
            try {
                await this._cache.write({state, resolvedLocation: resolved});
            } catch {
                this._logger?.debug('weather.cache.write.failed');
            }
            return state;
        } catch (error) {
            if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return this.getState();
            const hasCache = Boolean(previous?.lastSuccessfulRefresh);
            const state = {
                ...previous,
                status: hasCache ? 'stale' : 'error',
                stale: hasCache,
                error: 'Weather is temporarily unavailable. Check the location or connection.',
            };
            this._setState(state);
            this._logger?.debug('weather.refresh.failed', {message: error.message});
            return state;
        } finally {
            if (this._cancellable === cancellable)
                this._cancellable = null;
        }
    }

    async _resolveLocation(query, cancellable) {
        if (this._resolvedLocation?.query === query)
            return this._resolvedLocation;

        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}` +
            '&count=1&language=en&format=json';
        const payload = await this._getJson(url, cancellable);
        const result = payload.results?.[0];
        if (!result || !Number.isFinite(result.latitude) || result.latitude < -90 ||
            result.latitude > 90 || !Number.isFinite(result.longitude) ||
            result.longitude < -180 || result.longitude > 180)
            throw new Error('Location not found');
        const truncate = (value, maximum) => [...value].slice(0, maximum).join('');
        const cleanPart = value => typeof value === 'string'
            ? truncate(value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
                .trim(), 80)
            : '';
        const name = cleanPart(result.name);
        if (!name)
            throw new Error('Location not found');
        const suffix = [cleanPart(result.admin1), cleanPart(result.country)]
            .filter(Boolean)
            .join(', ');
        this._resolvedLocation = {
            query,
            latitude: result.latitude,
            longitude: result.longitude,
            displayName: truncate(suffix ? `${name}, ${suffix}` : name, 240),
        };
        return this._resolvedLocation;
    }

    _fetchForecast(location, unit, cancellable) {
        const temperatureUnit = unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
        const params = [
            `latitude=${location.latitude}`,
            `longitude=${location.longitude}`,
            'current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',
            'hourly=temperature_2m,weather_code,precipitation_probability',
            'daily=temperature_2m_max,temperature_2m_min,uv_index_max,sunrise,sunset',
            `temperature_unit=${temperatureUnit}`,
            'wind_speed_unit=kmh',
            'timeformat=unixtime',
            'timezone=auto',
            'forecast_days=2',
        ];
        return this._getJson(`https://api.open-meteo.com/v1/forecast?${params.join('&')}`, cancellable);
    }

    async _getJson(url, cancellable) {
        const message = Soup.Message.new('GET', url);
        const stream = await this._session.send_async(
            message,
            GLib.PRIORITY_DEFAULT,
            cancellable
        );
        try {
            if (message.get_status() < 200 || message.get_status() >= 300)
                throw new Error(`HTTP ${message.get_status()}`);
            const contentLength = message.get_response_headers().get_content_length();
            if (contentLength > MAX_RESPONSE_BYTES)
                throw new Error('Weather response is too large');
            const chunks = [];
            let total = 0;
            while (true) {
                const bytes = await stream.read_bytes_async(
                    64 * 1024,
                    GLib.PRIORITY_DEFAULT,
                    cancellable
                );
                const data = bytes.get_data();
                if (!data?.length)
                    break;
                total += data.length;
                if (total > MAX_RESPONSE_BYTES)
                    throw new Error('Weather response is too large');
                chunks.push(data);
            }
            const contents = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) {
                contents.set(chunk, offset);
                offset += chunk.length;
            }
            return JSON.parse(new TextDecoder().decode(contents));
        } finally {
            try {
                await stream.close_async(GLib.PRIORITY_DEFAULT, null);
            } catch {
                // The request may already be cancelled or closed by Soup.
            }
        }
    }

    destroy() {
        this._destroyed = true;
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        if (this._settingsRefreshId)
            GLib.Source.remove(this._settingsRefreshId);
        this._settingsRefreshId = 0;
        this._pendingRefresh = false;
        this._cancellable?.cancel();
        this._session.abort();
        this._scheduler.cancel('weather-refresh');
        super.destroy();
    }
}

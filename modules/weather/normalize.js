const CONDITIONS = Object.freeze({
    0: ['Clear sky', 'weather-clear-symbolic'],
    1: ['Mainly clear', 'weather-few-clouds-symbolic'],
    2: ['Partly cloudy', 'weather-few-clouds-symbolic'],
    3: ['Overcast', 'weather-overcast-symbolic'],
    45: ['Fog', 'weather-fog-symbolic'],
    48: ['Rime fog', 'weather-fog-symbolic'],
    51: ['Light drizzle', 'weather-showers-scattered-symbolic'],
    53: ['Drizzle', 'weather-showers-scattered-symbolic'],
    55: ['Heavy drizzle', 'weather-showers-symbolic'],
    56: ['Light freezing drizzle', 'weather-showers-scattered-symbolic'],
    57: ['Freezing drizzle', 'weather-showers-symbolic'],
    61: ['Light rain', 'weather-showers-scattered-symbolic'],
    63: ['Rain', 'weather-showers-symbolic'],
    65: ['Heavy rain', 'weather-showers-symbolic'],
    66: ['Light freezing rain', 'weather-showers-scattered-symbolic'],
    67: ['Freezing rain', 'weather-showers-symbolic'],
    71: ['Light snow', 'weather-snow-symbolic'],
    73: ['Snow', 'weather-snow-symbolic'],
    75: ['Heavy snow', 'weather-snow-symbolic'],
    77: ['Snow grains', 'weather-snow-symbolic'],
    80: ['Rain showers', 'weather-showers-scattered-symbolic'],
    81: ['Rain showers', 'weather-showers-symbolic'],
    82: ['Heavy showers', 'weather-showers-symbolic'],
    85: ['Light snow showers', 'weather-snow-symbolic'],
    86: ['Heavy snow showers', 'weather-snow-symbolic'],
    95: ['Thunderstorm', 'weather-storm-symbolic'],
    96: ['Thunderstorm with hail', 'weather-storm-symbolic'],
    99: ['Heavy thunderstorm', 'weather-storm-symbolic'],
});

export function weatherCondition(code) {
    const [label, icon] = Object.hasOwn(CONDITIONS, code)
        ? CONDITIONS[code]
        : ['Unknown conditions', 'weather-severe-alert-symbolic'];
    return {label, icon};
}

export function normalizeWeatherQuery(value) {
    const query = typeof value === 'string' ? value : '';
    const clean = query
        .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\s*,\s*/g, ', ')
        .trim();
    return [...clean].slice(0, 120).join('') || 'Cairo, Egypt';
}

export function weatherSearchQueries(value) {
    const query = normalizeWeatherQuery(value);
    const candidates = [query];
    const comma = query.indexOf(',');
    const place = comma >= 0 ? query.slice(0, comma) : query;
    const qualifier = comma >= 0 ? query.slice(comma) : '';
    const relaxedPlace = place
        .replace(/[-\u2010-\u2015]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const relaxed = `${relaxedPlace}${qualifier}`;
    if (relaxedPlace && relaxed !== query)
        candidates.push(relaxed);
    return candidates;
}

function validCondition(condition) {
    return condition && typeof condition.label === 'string' && condition.label.length <= 120 &&
        typeof condition.icon === 'string' && /^weather-[a-z0-9-]+-symbolic$/.test(condition.icon);
}

export function weatherCacheMatchesSettings(cached, query, unit) {
    const state = cached?.state;
    const location = cached?.resolvedLocation;
    if (!state || !location || !Number.isFinite(state.lastSuccessfulRefresh) ||
        state.lastSuccessfulRefresh <= 0 ||
        state.lastSuccessfulRefresh > Date.now() + 5 * 60 * 1000 ||
        state.unit !== unit || location.query !== query ||
        !Number.isFinite(location.latitude) || location.latitude < -90 || location.latitude > 90 ||
        !Number.isFinite(location.longitude) || location.longitude < -180 || location.longitude > 180 ||
        typeof location.displayName !== 'string' || location.displayName.length > 240 ||
        typeof state.location !== 'string' || state.location.length > 240 ||
        !state.current || !state.today || !Array.isArray(state.forecast) ||
        !validCondition(state.current.condition)) {
        return false;
    }
    const metrics = [
        state.current.temperature,
        state.current.feelsLike,
        state.current.humidity,
        state.current.wind,
        state.today.high,
        state.today.low,
    ];
    if (metrics.some(value => !Number.isFinite(value)))
        return false;
    if (state.current.rainProbability != null &&
        (!Number.isFinite(state.current.rainProbability) || state.current.rainProbability < 0 ||
            state.current.rainProbability > 100))
        return false;
    if (state.today.uv != null &&
        (!Number.isFinite(state.today.uv) || state.today.uv < 0 || state.today.uv > 100))
        return false;
    for (const timestamp of [state.today.sunrise, state.today.sunset]) {
        if (timestamp != null && (!Number.isFinite(timestamp) || timestamp <= 0))
            return false;
    }
    return state.forecast.length <= 12 && state.forecast.every(hour =>
        Number.isFinite(hour?.time) && Number.isFinite(hour?.temperature) &&
        (hour.precipitationChance === null || Number.isFinite(hour.precipitationChance)) &&
        validCondition(hour.condition));
}

export function normalizeWeather(payload, location, unit, nowMs = Date.now()) {
    const current = payload?.current;
    const daily = payload?.daily;
    const hourly = payload?.hourly;
    if (!current || !daily || !hourly)
        throw new Error('Weather service returned incomplete data');

    const requiredNumbers = [
        current.temperature_2m,
        current.apparent_temperature,
        current.relative_humidity_2m,
        current.wind_speed_10m,
        daily.temperature_2m_max?.[0],
        daily.temperature_2m_min?.[0],
    ].map(Number);
    if (requiredNumbers.some(value => !Number.isFinite(value)) ||
        requiredNumbers[0] < -150 || requiredNumbers[0] > 150 ||
        requiredNumbers[1] < -150 || requiredNumbers[1] > 150 ||
        requiredNumbers[2] < 0 || requiredNumbers[2] > 100 ||
        requiredNumbers[3] < 0 || requiredNumbers[3] > 1000 ||
        requiredNumbers[4] < -150 || requiredNumbers[4] > 150 ||
        requiredNumbers[5] < -150 || requiredNumbers[5] > 150)
        throw new Error('Weather service returned invalid numeric data');

    const currentTime = Number(current.time) || Math.floor(nowMs / 1000);
    const forecast = (hourly.time ?? [])
        .map((time, index) => ({
            time: Number(time),
            temperature: Number(hourly.temperature_2m?.[index]),
            precipitationChance: Number.isFinite(Number(hourly.precipitation_probability?.[index]))
                ? Math.max(0, Math.min(100, Math.round(Number(hourly.precipitation_probability[index]))))
                : null,
            condition: weatherCondition(hourly.weather_code?.[index]),
        }))
        .filter(item => Number.isFinite(item.time) &&
            Number.isFinite(new Date(item.time * 1000).getTime()) &&
            Number.isFinite(item.temperature) && item.temperature >= -150 &&
            item.temperature <= 150 && item.time >= currentTime)
        .slice(0, 12);

    const uv = Number(daily.uv_index_max?.[0]);
    const sunrise = Number(daily.sunrise?.[0]);
    const sunset = Number(daily.sunset?.[0]);

    return {
        status: 'success',
        stale: false,
        error: null,
        location,
        unit,
        timezone: typeof payload.timezone === 'string' &&
            /^[A-Za-z0-9_+./-]{1,80}$/.test(payload.timezone)
            ? payload.timezone
            : null,
        current: {
            temperature: requiredNumbers[0],
            feelsLike: requiredNumbers[1],
            humidity: requiredNumbers[2],
            wind: requiredNumbers[3],
            rainProbability: forecast[0]?.precipitationChance ?? null,
            condition: weatherCondition(current.weather_code),
        },
        today: {
            high: requiredNumbers[4],
            low: requiredNumbers[5],
            uv: Number.isFinite(uv) && uv >= 0 && uv <= 100 ? uv : null,
            sunrise: Number.isFinite(sunrise) && sunrise > 0 ? sunrise : null,
            sunset: Number.isFinite(sunset) && sunset > 0 ? sunset : null,
        },
        forecast,
        lastSuccessfulRefresh: nowMs,
    };
}

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {formatClock} from '../../lib/format.js';
import {
    iconButton,
    pageTitle,
    resolveAccent,
    scrollContainer,
    stateMessage,
    textButton,
} from '../../ui/components.js';
import {BasePage} from '../basePage.js';

export class WeatherPage extends BasePage {
    constructor(context) {
        super(context, 'weather');
        this._provider = context.weatherProvider;
        this.track(this._provider.subscribe(() => this._render()));
    }

    onPopupOpened() {
        if (this.context.settings.get_boolean('refresh-on-open') && this._provider.isStale())
            this._provider.refresh(false);
    }

    _render() {
        if (this._pageDestroyed || !this.actor)
            return;
        const state = this._provider.getState();
        this.replaceContent(page => {
            page.add_child(pageTitle('Weather', iconButton(
                'view-refresh-symbolic',
                'Refresh weather',
                () => this._provider.refresh(true),
                'shadow-icon-button shadow-action-icon-button'
            )));

            if (state.status === 'loading' && !state.lastSuccessfulRefresh) {
                page.add_child(stateMessage(
                    'content-loading-symbolic',
                    'Loading weather',
                    'Contacting Open-Meteo…'
                ));
                return;
            }
            if (state.status === 'error' && !state.lastSuccessfulRefresh) {
                page.add_child(stateMessage(
                    'network-error-symbolic',
                    'Weather unavailable',
                    state.error,
                    textButton('Retry', () => this._provider.refresh(true))
                ));
                return;
            }

            const unit = '°';
            const content = new St.BoxLayout({
                vertical: true,
                style_class: 'shadow-weather-content',
                x_expand: true,
            });
            content.add_child(this._hero(state, unit));

            const metrics = this._selectedMetrics(state, unit).slice(0, 4);
            if (metrics.length)
                content.add_child(this._metricGrid(metrics));

            content.add_child(this._hourlyForecast(state));

            if (this.context.settings.get_boolean('show-weather-sun-times') &&
                (state.today.sunrise || state.today.sunset)) {
                content.add_child(this._sunTimes(state));
            }

            content.add_child(new St.Label({
                text: this._footerText(state),
                style_class: 'shadow-provider-footer shadow-muted',
                x_align: Clutter.ActorAlign.START,
            }));
            page.add_child(scrollContainer(content, 'shadow-weather-scroll'));
        });
    }

    _hero(state, unit) {
        const hero = new St.BoxLayout({
            vertical: true,
            style_class: 'shadow-card shadow-weather-hero',
            x_expand: true,
        });
        const primary = new St.BoxLayout({x_expand: true});
        const temperature = new St.BoxLayout({vertical: true, x_expand: true});
        temperature.add_child(new St.Label({
            text: `${Math.round(state.current.temperature)}${unit}`,
            style_class: 'shadow-weather-temperature',
            x_align: Clutter.ActorAlign.START,
        }));
        const condition = new St.Label({
            text: state.current.condition.label,
            style_class: 'shadow-weather-condition',
            x_align: Clutter.ActorAlign.START,
        });
        condition.clutter_text.set_single_line_mode(true);
        condition.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        temperature.add_child(condition);
        primary.add_child(temperature);
        primary.add_child(new St.Bin({
            style_class: 'shadow-weather-icon-tile',
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: state.current.condition.icon,
                icon_size: 38,
                style: `color: ${resolveAccent(this.context.settings)};`,
            }),
        }));
        hero.add_child(primary);

        const locationRow = new St.BoxLayout({style_class: 'shadow-weather-location-row'});
        const location = new St.Label({
            text: state.location,
            style_class: 'shadow-weather-location',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        location.clutter_text.set_single_line_mode(true);
        location.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        locationRow.add_child(location);
        locationRow.add_child(new St.Label({
            text: `Today  ${Math.round(state.today.high)}° / ${Math.round(state.today.low)}°`,
            style_class: 'shadow-weather-today',
        }));
        hero.add_child(locationRow);
        return hero;
    }

    _selectedMetrics(state, unit) {
        const candidates = [
            ['show-weather-feels-like', 'Feels like', `${Math.round(state.current.feelsLike)}${unit}`],
            ['show-weather-humidity', 'Humidity', `${Math.round(state.current.humidity)}%`],
            ['show-weather-wind', 'Wind', `${Math.round(state.current.wind)} km/h`],
            ['show-weather-rain', 'Rain', Number.isFinite(state.current.rainProbability)
                ? `${Math.round(state.current.rainProbability)}%`
                : null],
            ['show-weather-uv', 'UV', Number.isFinite(state.today.uv)
                ? this._formatUv(state.today.uv)
                : null],
        ];
        return candidates
            .filter(([key, _label, value]) =>
                value !== null && this.context.settings.get_boolean(key))
            .map(([_key, label, value]) => [label, value]);
    }

    _metricGrid(metrics) {
        const grid = new St.BoxLayout({
            vertical: true,
            style_class: 'shadow-secondary-surface shadow-weather-metrics',
        });
        for (let index = 0; index < metrics.length; index += 2) {
            const row = new St.BoxLayout({style_class: 'shadow-weather-metric-row', x_expand: true});
            row.add_child(this._metric(...metrics[index]));
            if (metrics[index + 1])
                row.add_child(this._metric(...metrics[index + 1]));
            else
                row.add_child(new St.Widget({x_expand: true}));
            grid.add_child(row);
        }
        return grid;
    }

    _metric(label, value) {
        const metric = new St.BoxLayout({
            vertical: true,
            style_class: 'shadow-weather-metric',
            x_expand: true,
        });
        metric.add_child(new St.Label({text: label, style_class: 'shadow-metric-label'}));
        metric.add_child(new St.Label({text: value, style_class: 'shadow-metric-value'}));
        return metric;
    }

    _hourlyForecast(state) {
        const section = new St.BoxLayout({vertical: true, style_class: 'shadow-hourly-section'});
        section.add_child(new St.Label({
            text: 'NEXT HOURS',
            style_class: 'shadow-section-label',
            x_align: Clutter.ActorAlign.START,
        }));
        if (!state.forecast.length) {
            section.add_child(new St.Label({
                text: 'Hourly forecast is temporarily unavailable.',
                style_class: 'shadow-inline-empty shadow-muted',
            }));
            return section;
        }
        const row = new St.BoxLayout({
            style_class: 'shadow-secondary-surface shadow-hourly-row',
            x_expand: true,
        });
        for (const hour of state.forecast.slice(0, 4)) {
            const item = new St.BoxLayout({
                vertical: true,
                style_class: 'shadow-hourly-item',
                x_expand: true,
            });
            item.add_child(new St.Label({
                text: this._formatHour(hour.time, state.timezone),
                style_class: 'shadow-hourly-time',
            }));
            item.add_child(new St.Icon({
                icon_name: hour.condition.icon,
                icon_size: 17,
                style_class: 'shadow-hourly-icon',
            }));
            item.add_child(new St.Label({
                text: `${Math.round(hour.temperature)}°`,
                style_class: 'shadow-hourly-temperature',
            }));
            row.add_child(item);
        }
        section.add_child(row);
        return section;
    }

    _sunTimes(state) {
        const row = new St.BoxLayout({style_class: 'shadow-sun-row', x_expand: true});
        if (state.today.sunrise) {
            row.add_child(new St.Label({
                text: `Sunrise  ${this._formatHour(state.today.sunrise, state.timezone)}`,
                style_class: 'shadow-muted',
                x_expand: true,
            }));
        }
        if (state.today.sunset) {
            row.add_child(new St.Label({
                text: `Sunset  ${this._formatHour(state.today.sunset, state.timezone)}`,
                style_class: 'shadow-muted',
            }));
        }
        return row;
    }

    _footerText(state) {
        if (state.status === 'refreshing')
            return `Updating… · Updated ${formatClock(state.lastSuccessfulRefresh)}`;
        if (state.status === 'stale' || state.status === 'cached') {
            const minutes = Math.max(0, Math.floor(
                (Date.now() - state.lastSuccessfulRefresh) / 60_000
            ));
            const age = minutes < 1 ? 'just now' :
                minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
            return `Updated ${age} · Cached`;
        }
        return `Updated ${formatClock(state.lastSuccessfulRefresh)}`;
    }

    _formatUv(value) {
        const rounded = Math.round(value);
        const label = value >= 11 ? 'Extreme' : value >= 8 ? 'Very high' :
            value >= 6 ? 'High' : value >= 3 ? 'Moderate' : 'Low';
        return `${rounded} ${label}`;
    }

    _formatHour(timestamp, timezone) {
        try {
            return new Intl.DateTimeFormat([], {
                hour: 'numeric',
                timeZone: timezone ?? undefined,
            }).format(new Date(timestamp * 1000));
        } catch {
            return new Date(timestamp * 1000).toLocaleTimeString([], {hour: 'numeric'});
        }
    }
}

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {formatClock} from '../../lib/format.js';
import {BasePage} from '../basePage.js';
import {
    clearChildren,
    iconButton,
    pageTitle,
    resolveAccent,
    scrollContainer,
    stateMessage,
    textButton,
} from '../../ui/components.js';

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
        if (!this.actor)
            return;
        const state = this._provider.getState();
        clearChildren(this.actor);
        const refresh = iconButton('view-refresh-symbolic', 'Refresh weather', () =>
            this._provider.refresh(true), 'shadow-icon-button shadow-accent-button');
        refresh.set_style(`color: ${resolveAccent(this.context.settings)};`);
        this.actor.add_child(pageTitle('Weather', refresh));

        if (state.status === 'loading' && !state.lastSuccessfulRefresh) {
            this.actor.add_child(stateMessage(
                'content-loading-symbolic',
                'Loading weather',
                'Contacting Open-Meteo…'
            ));
            return;
        }
        if (state.status === 'error' && !state.lastSuccessfulRefresh) {
            this.actor.add_child(stateMessage(
                'network-error-symbolic',
                'Weather unavailable',
                state.error,
                textButton('Retry', () => this._provider.refresh(true))
            ));
            return;
        }

        const unit = state.unit === 'fahrenheit' ? '°F' : '°C';
        const content = new St.BoxLayout({
            vertical: true,
            style_class: 'shadow-weather-content',
            x_expand: true,
        });
        const hero = new St.BoxLayout({style_class: 'shadow-weather-hero', x_expand: true});
        hero.add_child(new St.Bin({
            style_class: 'shadow-weather-icon-tile',
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: state.current.condition.icon,
                icon_size: 36,
                style: `color: ${resolveAccent(this.context.settings)};`,
            }),
        }));
        const heroText = new St.BoxLayout({
            vertical: true,
            style_class: 'shadow-weather-hero-text',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        heroText.add_child(new St.Label({
            text: `${Math.round(state.current.temperature)}${unit}`,
            style_class: 'shadow-weather-temperature',
            x_align: Clutter.ActorAlign.START,
        }));
        heroText.add_child(new St.Label({
            text: state.current.condition.label,
            style_class: 'shadow-weather-condition',
            x_align: Clutter.ActorAlign.START,
        }));
        const location = new St.Label({
            text: state.location,
            style_class: 'shadow-weather-location',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        location.clutter_text.set_single_line_mode(true);
        location.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        heroText.add_child(location);
        hero.add_child(heroText);
        content.add_child(hero);

        const metrics = new St.BoxLayout({vertical: true, style_class: 'shadow-weather-metrics'});
        const firstRow = new St.BoxLayout({style_class: 'shadow-weather-metric-row', x_expand: true});
        firstRow.add_child(this._metric('Feels like', `${Math.round(state.current.feelsLike)}${unit}`));
        firstRow.add_child(this._metric('Humidity', `${Math.round(state.current.humidity)}%`));
        metrics.add_child(firstRow);
        const secondRow = new St.BoxLayout({style_class: 'shadow-weather-metric-row', x_expand: true});
        secondRow.add_child(this._metric('Wind', `${Math.round(state.current.wind)} km/h`));
        secondRow.add_child(this._metric('High / low',
            `${Math.round(state.today.high)}° / ${Math.round(state.today.low)}°`));
        metrics.add_child(secondRow);
        content.add_child(metrics);

        const forecastHeading = new St.BoxLayout({style_class: 'shadow-section-heading', x_expand: true});
        forecastHeading.add_child(new St.Label({
            text: 'Next hours',
            style_class: 'shadow-section-title',
            x_expand: true,
        }));
        const rainChances = state.forecast
            .map(hour => hour.precipitationChance)
            .filter(Number.isFinite);
        const peakRain = rainChances.length ? Math.max(...rainChances) : null;
        const forecastContext = peakRain === null
            ? 'Local time'
            : `${peakRain > 0 ? `Rain up to ${peakRain}%` : 'Dry'} · Local time`;
        forecastHeading.add_child(new St.Label({text: forecastContext, style_class: 'shadow-muted'}));
        content.add_child(forecastHeading);

        if (state.forecast.length) {
            const forecast = new St.BoxLayout({style_class: 'shadow-hourly-row', x_expand: true});
            for (const hour of state.forecast.slice(0, 5)) {
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
                forecast.add_child(item);
            }
            content.add_child(forecast);
        } else {
            content.add_child(new St.Label({
                text: 'Hourly forecast is temporarily unavailable.',
                style_class: 'shadow-hourly-empty shadow-muted',
            }));
        }

        const footerText = state.status === 'stale'
            ? `Cached weather · refresh unavailable`
            : state.status === 'cached'
                ? `Cached · updated ${formatClock(state.lastSuccessfulRefresh)}`
                : state.status === 'refreshing'
                    ? `Updating · last refreshed ${formatClock(state.lastSuccessfulRefresh)}`
                : `Updated ${formatClock(state.lastSuccessfulRefresh)}`;
        content.add_child(new St.Label({
            text: footerText,
            style_class: 'shadow-provider-footer shadow-muted',
            x_align: Clutter.ActorAlign.START,
        }));
        this.actor.add_child(scrollContainer(content, 'shadow-weather-scroll'));
    }

    _metric(label, value) {
        const tile = new St.BoxLayout({
            vertical: true,
            style_class: 'shadow-weather-metric',
            x_expand: true,
        });
        tile.add_child(new St.Label({text: label, style_class: 'shadow-metric-label'}));
        tile.add_child(new St.Label({text: value, style_class: 'shadow-metric-value'}));
        return tile;
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

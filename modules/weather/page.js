import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {
    horizontalScrollContainer,
    animateRefreshButton,
    attachTooltip,
    fitScrollToContent,
    iconButton,
    pageTitle,
    resolveAccent,
    scrollContainer,
    sectionTitle,
    stateMessage,
    statusPill,
    textButton,
} from '../../ui/components.js';
import {BasePage} from '../basePage.js';
import {weatherDisplayLocation} from './normalize.js';

export class WeatherPage extends BasePage {
    constructor(context) {
        super(context, 'weather');
        this._provider = context.weatherProvider;
        this._popupOpen = false;
        this.track(this._provider.subscribe(() => this._render()));
    }

    onPopupOpened() {
        this._popupOpen = true;
        this._render();
        if (this.context.settings.get_boolean('refresh-on-open') && this._provider.isStale())
            this._provider.refresh(false);
    }

    onPopupClosed() {
        this._popupOpen = false;
        this._stopRefreshAnimation();
    }

    activate() {
        fitScrollToContent(this._scroll, this._scrollContent, this.context);
        const adjustment = this._scroll?.vadjustment ?? this._scroll?.vscroll?.adjustment;
        adjustment?.set_value(0);
    }

    _render() {
        if (this._pageDestroyed || !this.actor)
            return;
        const state = this._provider.getState();
        this.replaceContent(page => {
            page.add_child(pageTitle('Weather', this._actions(state)));

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

            if (!state.current || !state.today) {
                page.add_child(stateMessage(
                    'weather-severe-alert-symbolic',
                    'Weather data incomplete',
                    'The last forecast could not be displayed safely.',
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

            const metrics = this._selectedMetrics(state, unit).slice(0, 5);
            if (metrics.length)
                content.add_child(this._metricGrid(metrics));

            content.add_child(this._hourlyForecast(state));

            if (this.context.settings.get_boolean('show-weather-sun-times') &&
                (state.today.sunrise || state.today.sunset)) {
                content.add_child(this._sunTimes(state));
            }

            const insight = this._weatherInsight(state);
            if (insight)
                content.add_child(insight);

            this._scrollContent = content;
            this._scroll = scrollContainer(content, 'shadow-weather-scroll');
            fitScrollToContent(this._scroll, content, this.context);
            page.add_child(this._scroll);
        });
    }

    _actions(state) {
        const actions = new St.BoxLayout({style_class: 'shadow-title-actions'});
        if (state.status === 'stale' || state.status === 'cached')
            actions.add_child(statusPill(this.context.settings, 'Cached', 'neutral'));
        const refreshing = state.status === 'refreshing' || state.status === 'loading';
        const refresh = iconButton(
            refreshing ? 'process-working-symbolic' : 'view-refresh-symbolic',
            refreshing ? 'Refreshing weather' : 'Refresh weather',
            () => this._provider.refresh(true),
            'shadow-icon-button shadow-action-icon-button'
        );
        refresh.reactive = !refreshing;
        refresh.can_focus = !refreshing;
        this._refreshIcon = animateRefreshButton(
            refresh,
            this.context.settings,
            refreshing && this._popupOpen
        );
        actions.add_child(refresh);
        return actions;
    }

    _hero(state, unit) {
        const hero = new St.BoxLayout({
            vertical: true,
            style_class: 'shadow-card shadow-weather-hero',
            x_expand: true,
        });
        const primary = new St.BoxLayout({style_class: 'shadow-weather-primary', x_expand: true});
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

        const locationRow = new St.BoxLayout({
            style_class: 'shadow-weather-location-row',
            x_expand: true,
        });
        const location = new St.Label({
            text: weatherDisplayLocation(state.location),
            style_class: 'shadow-weather-location',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        location.clutter_text.set_single_line_mode(true);
        location.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        location.accessible_name = state.location;
        attachTooltip(location, state.location);
        locationRow.add_child(location);
        locationRow.add_child(new St.Label({
            text: `H ${Math.round(state.today.high)}°  ·  L ${Math.round(state.today.low)}°`,
            style_class: 'shadow-weather-today',
        }));
        hero.add_child(locationRow);
        return hero;
    }

    _selectedMetrics(state, unit) {
        const windUnit = this.context.settings.get_string('weather-wind-unit');
        const wind = windUnit === 'mph' ? state.current.wind * 0.621371 : state.current.wind;
        const candidates = [
            ['show-weather-feels-like', 'Feels like', `${Math.round(state.current.feelsLike)}${unit}`],
            ['show-weather-humidity', 'Humidity', `${Math.round(state.current.humidity)}%`],
            ['show-weather-wind', 'Wind', `${Math.round(wind)} ${windUnit === 'mph' ? 'mph' : 'km/h'}`],
            ['show-weather-rain', 'Rain', Number.isFinite(state.current.rainProbability)
                ? `${Math.round(state.current.rainProbability)}%`
                : null],
            ['show-weather-uv', 'UV Index', Number.isFinite(state.today.uv)
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
        section.add_child(sectionTitle('Next hours'));
        if (!state.forecast.length) {
            section.add_child(new St.Label({
                text: 'Hourly forecast is temporarily unavailable.',
                style_class: 'shadow-inline-empty shadow-muted',
            }));
            return section;
        }
        const row = new St.BoxLayout({style_class: 'shadow-hourly-row'});
        const itemWidth = this.context.settings.get_string('density') === 'compact' ? 78 : 88;
        for (const hour of state.forecast) {
            const item = new St.BoxLayout({
                vertical: true,
                style_class: 'shadow-hourly-item',
                width: itemWidth,
                accessible_name: `${this._formatHour(hour.time, state.timezone)}, ` +
                    `${Math.round(hour.temperature)} degrees`,
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
            if (this.context.settings.get_boolean('show-weather-rain') &&
                Number.isFinite(hour.precipitationChance)) {
                item.add_child(new St.Label({
                    text: `${Math.round(hour.precipitationChance)}%`,
                    style_class: 'shadow-hourly-precipitation',
                }));
            }
            row.add_child(item);
        }
        const scroll = horizontalScrollContainer(row, 'shadow-hourly-scroll');
        section.add_child(new St.Bin({
            style_class: 'shadow-secondary-surface shadow-hourly-frame',
            width: this._hourlyViewportWidth(),
            child: scroll,
        }));
        return section;
    }

    _hourlyViewportWidth() {
        const widths = {narrow: 346, standard: 382, wide: 416};
        const configured = this.context.settings.get_string('panel-width');
        return widths[configured] ?? widths.standard;
    }

    _weatherInsight(state) {
        if (!this.context.settings.get_boolean('show-weather-insights'))
            return null;
        const uv = state.today.uv;
        const upcoming = state.forecast.slice(0, 6)
            .filter(hour => Number.isFinite(hour.precipitationChance));
        const wettest = upcoming.length
            ? upcoming.reduce((peak, hour) =>
                hour.precipitationChance > peak.precipitationChance ? hour : peak)
            : null;
        let message = null;
        let iconName = 'weather-clear-symbolic';
        if (Number.isFinite(uv) && uv >= 8) {
            message = `UV is ${uv >= 11 ? 'extreme' : 'very high'} today.`;
        } else if (state.current.feelsLike >= 35) {
            message = `Hot conditions · Feels like ${Math.round(state.current.feelsLike)}°.`;
        } else if (wettest?.precipitationChance >= 35) {
            message = `Rain chance peaks at ${Math.round(wettest.precipitationChance)}% around ` +
                `${this._formatHour(wettest.time, state.timezone)}.`;
            iconName = 'weather-showers-scattered-symbolic';
        }
        if (!message)
            return null;
        const row = new St.BoxLayout({
            style_class: 'shadow-page-insight shadow-secondary-surface',
            x_expand: true,
        });
        row.add_child(new St.Icon({
            icon_name: iconName,
            icon_size: 15,
            style: `color: ${resolveAccent(this.context.settings)};`,
        }));
        row.add_child(new St.Label({text: message, style_class: 'shadow-page-insight-text'}));
        return row;
    }

    _sunTimes(state) {
        const row = new St.BoxLayout({
            style_class: 'shadow-secondary-surface shadow-sun-row',
            x_expand: true,
        });
        if (state.today.sunrise) {
            row.add_child(this._sunMetric(
                'Sunrise',
                this._formatHour(state.today.sunrise, state.timezone)
            ));
        }
        if (state.today.sunset) {
            row.add_child(this._sunMetric(
                'Sunset',
                this._formatHour(state.today.sunset, state.timezone)
            ));
        }
        return row;
    }

    _sunMetric(label, value) {
        const metric = new St.BoxLayout({vertical: true, x_expand: true});
        metric.add_child(new St.Label({text: label, style_class: 'shadow-metric-label'}));
        metric.add_child(new St.Label({text: value, style_class: 'shadow-metric-value'}));
        return metric;
    }

    _formatUv(value) {
        const rounded = Math.round(value);
        const label = value >= 11 ? 'Extreme' : value >= 8 ? 'Very High' :
            value >= 6 ? 'High' : value >= 3 ? 'Moderate' : 'Low';
        return `${rounded} · ${label}`;
    }

    _stopRefreshAnimation() {
        this._refreshIcon?.remove_all_transitions();
        if (this._refreshIcon)
            this._refreshIcon.rotation_angle_z = 0;
        this._refreshIcon = null;
    }

    destroy() {
        this._stopRefreshAnimation();
        super.destroy();
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

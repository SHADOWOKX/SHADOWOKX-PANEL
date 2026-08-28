import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {ACCENTS, MODULE_META} from '../lib/constants.js';
import {clampPercent, isHexColor} from '../lib/format.js';

export function clearChildren(actor) {
    for (const child of actor.get_children())
        child.destroy();
}

export function resolveAccent(settings) {
    const preset = settings.get_string('accent-color');
    if (preset === 'custom') {
        const custom = settings.get_string('custom-accent');
        return isHexColor(custom) ? custom : ACCENTS.purple;
    }
    return ACCENTS[preset] ?? ACCENTS.purple;
}

export function contrastForeground(color) {
    if (!isHexColor(color))
        return '#ffffff';
    const channels = [1, 3, 5].map(index => {
        const value = Number.parseInt(color.slice(index, index + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    return luminance > 0.34 ? '#111318' : '#ffffff';
}

export function accentRgba(settings, alpha) {
    const accent = resolveAccent(settings);
    const red = Number.parseInt(accent.slice(1, 3), 16);
    const green = Number.parseInt(accent.slice(3, 5), 16);
    const blue = Number.parseInt(accent.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function moduleIcon(extension, id, size = 16, styleClass = '') {
    const properties = {
        icon_size: size,
        style_class: styleClass,
    };
    if (id === 'codex') {
        const path = GLib.build_filenamev([
            extension.path,
            'icons',
            'chatgpt.png',
        ]);
        properties.gicon = Gio.icon_new_for_string(path);
    } else {
        properties.icon_name = MODULE_META[id]?.icon ?? 'application-x-executable-symbolic';
    }
    return new St.Icon(properties);
}

export function iconButton(iconName, accessibleName, callback, styleClass = 'shadow-icon-button') {
    const button = new St.Button({
        style_class: styleClass,
        can_focus: true,
        reactive: true,
        track_hover: true,
        accessible_name: accessibleName,
        child: new St.Icon({icon_name: iconName, icon_size: 16}),
    });
    button.connect('clicked', callback);
    return button;
}

export function moduleIconButton(
    extension,
    moduleId,
    accessibleName,
    callback,
    styleClass = 'shadow-icon-button'
) {
    const button = new St.Button({
        style_class: styleClass,
        can_focus: true,
        reactive: true,
        track_hover: true,
        accessible_name: accessibleName,
        child: moduleIcon(extension, moduleId, 16, 'shadow-button-brand-icon'),
    });
    button.connect('clicked', callback);
    return button;
}

export function textButton(label, callback, styleClass = 'shadow-text-button') {
    const button = new St.Button({
        label,
        style_class: styleClass,
        can_focus: true,
        reactive: true,
        track_hover: true,
    });
    button.connect('clicked', callback);
    return button;
}

export function pageTitle(title, action = null) {
    const box = new St.BoxLayout({style_class: 'shadow-page-title-row', x_expand: true});
    box.add_child(new St.Label({
        text: title,
        style_class: 'shadow-page-title',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    if (action)
        box.add_child(action);
    return box;
}

export function stateMessage(iconName, title, detail, action = null) {
    const box = new St.BoxLayout({
        vertical: true,
        style_class: 'shadow-state',
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    box.add_child(new St.Bin({
        style_class: 'shadow-state-icon-tile',
        x_align: Clutter.ActorAlign.CENTER,
        child: new St.Icon({icon_name: iconName, icon_size: 24, style_class: 'shadow-state-icon'}),
    }));
    box.add_child(new St.Label({text: title, style_class: 'shadow-state-title'}));
    if (detail) {
        const label = new St.Label({text: detail, style_class: 'shadow-state-detail'});
        label.clutter_text.set_line_wrap(true);
        box.add_child(label);
    }
    if (action)
        box.add_child(action);
    return box;
}

export function metricRow(label, value) {
    const row = new St.BoxLayout({style_class: 'shadow-metric-row', x_expand: true});
    row.add_child(new St.Label({text: label, style_class: 'shadow-metric-label', x_expand: true}));
    row.add_child(new St.Label({text: value, style_class: 'shadow-metric-value'}));
    return row;
}

export class ProgressMeter {
    constructor(percent, accent, width = 310, meaning = 'used', animate = false) {
        const value = clampPercent(percent);
        const targetWidth = Math.round(width * value / 100);
        this.actor = new St.Widget({
            style_class: 'shadow-progress-track',
            width,
            height: 7,
            clip_to_allocation: true,
            accessible_name: `${value}% ${meaning}`,
        });
        this._fill = new St.Widget({
            style_class: 'shadow-progress-fill',
            width: animate ? 0 : targetWidth,
            height: 7,
            style: `background-color: ${accent};`,
        });
        this.actor.add_child(this._fill);
        if (animate && targetWidth > 0) {
            this._fill.ease({
                width: targetWidth,
                duration: 160,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }
}

export function scrollContainer(child, styleClass = 'shadow-list-scroll') {
    const scroll = new St.ScrollView({
        style_class: styleClass,
        overlay_scrollbars: true,
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        x_expand: true,
        y_expand: true,
    });
    scroll.set_child(child);
    return scroll;
}

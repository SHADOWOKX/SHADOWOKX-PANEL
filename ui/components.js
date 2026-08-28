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

export function moduleTextButton(
    extension,
    moduleId,
    label,
    accessibleName,
    callback,
    styleClass = 'shadow-text-button'
) {
    const content = new St.BoxLayout({style_class: 'shadow-button-content'});
    content.add_child(moduleIcon(extension, moduleId, 16, 'shadow-button-brand-icon'));
    content.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
    const button = new St.Button({
        style_class: styleClass,
        can_focus: true,
        reactive: true,
        track_hover: true,
        accessible_name: accessibleName,
        child: content,
    });
    button.connect('clicked', callback);
    return button;
}

export function iconTextButton(
    iconName,
    label,
    accessibleName,
    callback,
    styleClass = 'shadow-text-button'
) {
    const content = new St.BoxLayout({style_class: 'shadow-button-content'});
    content.add_child(new St.Icon({icon_name: iconName, icon_size: 15}));
    content.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
    const button = new St.Button({
        style_class: styleClass,
        can_focus: true,
        reactive: true,
        track_hover: true,
        accessible_name: accessibleName,
        child: content,
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

export function pageTitle(title, action = null, leading = null) {
    const box = new St.BoxLayout({style_class: 'shadow-page-title-row', x_expand: true});
    if (leading)
        box.add_child(leading);
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

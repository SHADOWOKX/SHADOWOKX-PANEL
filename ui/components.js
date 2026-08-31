import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {ACCENTS, MODULE_META} from '../lib/constants.js';
import {clampPercent, isHexColor} from '../lib/format.js';

export function resolveAccent(settings) {
    const preset = settings.get_string('accent-color');
    if (preset === 'custom') {
        const custom = settings.get_string('custom-accent');
        return isHexColor(custom) ? custom : ACCENTS.rose;
    }
    return ACCENTS[preset] ?? ACCENTS.rose;
}

export function accentRgba(settings, alpha) {
    const accent = resolveAccent(settings);
    const red = Number.parseInt(accent.slice(1, 3), 16);
    const green = Number.parseInt(accent.slice(3, 5), 16);
    const blue = Number.parseInt(accent.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function animationsEnabled(settings) {
    return settings.get_boolean('animations') && St.Settings.get().enable_animations;
}

export function attachTooltip(actor, textOrProvider) {
    let tooltip = null;
    let timeoutId = 0;
    const text = () => typeof textOrProvider === 'function'
        ? textOrProvider()
        : textOrProvider;
    const hide = () => {
        if (timeoutId)
            GLib.Source.remove(timeoutId);
        timeoutId = 0;
        tooltip?.destroy();
        tooltip = null;
    };
    const show = () => {
        const value = text();
        if (!value || !actor.mapped)
            return;
        tooltip = new St.Label({text: value, style_class: 'shadow-tooltip'});
        global.stage.add_child(tooltip);
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        const [, tooltipWidth] = tooltip.get_preferred_width(-1);
        const [, tooltipHeight] = tooltip.get_preferred_height(tooltipWidth);
        const stageWidth = global.stage.width;
        const stageHeight = global.stage.height;
        const tooltipX = Math.max(8, Math.min(
            Math.round(x + width / 2 - tooltipWidth / 2),
            stageWidth - tooltipWidth - 8
        ));
        const below = y + height + 8;
        const tooltipY = below + tooltipHeight <= stageHeight - 8
            ? below
            : Math.max(8, y - tooltipHeight - 8);
        tooltip.set_position(tooltipX, tooltipY);
    };
    actor.reactive = true;
    actor.track_hover = true;
    actor.connect('notify::hover', () => {
        hide();
        if (!actor.hover)
            return;
        timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 450, () => {
            timeoutId = 0;
            show();
            return GLib.SOURCE_REMOVE;
        });
    });
    actor.connect('notify::mapped', () => {
        if (!actor.mapped)
            hide();
    });
    actor.connect('destroy', hide);
    return actor;
}

export function animateRefreshButton(button, settings, active) {
    const icon = button?.child;
    if (!icon || !active || !animationsEnabled(settings))
        return null;
    icon.set_pivot_point(0.5, 0.5);
    icon.ease({
        rotation_angle_z: 360,
        duration: 800,
        repeatCount: -1,
        mode: Clutter.AnimationMode.LINEAR,
    });
    return icon;
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
    return attachTooltip(button, accessibleName);
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
    return attachTooltip(button, accessibleName);
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
    const label = new St.Label({
        text: title,
        style_class: 'shadow-page-title',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    label.clutter_text.set_single_line_mode(true);
    label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
    box.add_child(label);
    if (action)
        box.add_child(action);
    return box;
}

export function sectionTitle(text, styleClass = 'shadow-section-title') {
    const label = new St.Label({
        text,
        style_class: styleClass,
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
    });
    label.clutter_text.set_single_line_mode(true);
    label.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
    return label;
}

export function statusPill(settings, text, tone = 'neutral', iconName = null) {
    const pill = new St.BoxLayout({
        style_class: `shadow-status-pill shadow-status-${tone}`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    if (iconName) {
        pill.add_child(new St.Icon({
            icon_name: iconName,
            icon_size: 11,
            style_class: 'shadow-status-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
    } else {
        pill.add_child(new St.Widget({
            style_class: 'shadow-status-dot',
            y_align: Clutter.ActorAlign.CENTER,
            style: tone === 'accent' || tone === 'info'
                ? `background-color: ${resolveAccent(settings)};`
                : null,
        }));
    }
    pill.add_child(new St.Label({
        text,
        style_class: 'shadow-status-label',
        y_align: Clutter.ActorAlign.CENTER,
    }));
    return pill;
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
            height: 9,
            clip_to_allocation: true,
            accessible_name: `${value}% ${meaning}`,
        });
        this._fill = new St.Widget({
            style_class: 'shadow-progress-fill',
            width: animate ? 0 : targetWidth,
            height: 9,
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
        vscrollbar_policy: St.PolicyType.NEVER,
        x_expand: true,
    });
    scroll.set_child(child);
    return scroll;
}

export function fitScrollToContent(scroll, child, context, pageActor = null) {
    if (!scroll || !child)
        return;
    const width = Math.max(1, (context.pageWidth ?? 386) - 4);
    const [, naturalHeight] = child.get_preferred_height(width);
    scroll._shadowNaturalHeight = Math.max(1, Math.ceil(naturalHeight));
    if (typeof context.fitPageScroll === 'function')
        context.fitPageScroll(scroll, pageActor);
    else
        scroll.height = scroll._shadowNaturalHeight;
}

export function resetScrollPosition(scroll) {
    const adjustment = scroll?.vadjustment ?? scroll?.vscroll?.adjustment;
    adjustment?.set_value(0);
}

export function horizontalScrollContainer(child, styleClass = 'shadow-horizontal-scroll') {
    const scroll = new St.ScrollView({
        style_class: styleClass,
        overlay_scrollbars: false,
        hscrollbar_policy: St.PolicyType.EXTERNAL,
        vscrollbar_policy: St.PolicyType.NEVER,
        x_expand: true,
        clip_to_allocation: true,
    });
    scroll.set_child(child);
    return scroll;
}

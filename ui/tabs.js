import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {MODULE_META} from '../lib/constants.js';
import {accentRgba, moduleIcon, resolveAccent} from './components.js';

export class TabStrip {
    constructor(extension, settings, moduleIds, onSelected) {
        this._extension = extension;
        this._settings = settings;
        this._onSelected = onSelected;
        this._buttons = new Map();
        this._activeId = null;

        this._box = new St.BoxLayout({style_class: 'shadow-tab-box'});
        this.actor = new St.ScrollView({
            style_class: 'shadow-tab-scroll',
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.EXTERNAL,
            vscrollbar_policy: St.PolicyType.NEVER,
            enable_mouse_scrolling: false,
            x_expand: true,
        });
        this.actor.connect('scroll-event', (_actor, event) => this._onScroll(event));
        this.actor.set_child(this._box);
        this.setModules(moduleIds);
    }

    _onScroll(event) {
        const adjustment = this.actor.get_hadjustment
            ? this.actor.get_hadjustment()
            : this.actor.get_hscroll_bar().get_adjustment();
        const increment = Math.max(adjustment.step_increment, 44);
        const direction = event.get_scroll_direction();
        let delta = 0;
        if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();
            delta = (Math.abs(dx) > Math.abs(dy) ? dx : dy) * increment;
        } else if (direction === Clutter.ScrollDirection.UP ||
            direction === Clutter.ScrollDirection.LEFT) {
            delta = -increment;
        } else if (direction === Clutter.ScrollDirection.DOWN ||
            direction === Clutter.ScrollDirection.RIGHT) {
            delta = increment;
        }
        if (delta === 0)
            return Clutter.EVENT_PROPAGATE;
        adjustment.set_value(adjustment.get_value() + delta);
        return Clutter.EVENT_STOP;
    }

    setModules(moduleIds) {
        for (const child of this._box.get_children())
            child.destroy();
        this._buttons.clear();
        this._activeId = null;
        for (const id of moduleIds) {
            const meta = MODULE_META[id];
            const content = new St.BoxLayout({style_class: 'shadow-tab-content'});
            const icon = moduleIcon(this._extension, id, 17, 'shadow-tab-icon');
            content.add_child(icon);
            const label = new St.Label({
                text: meta.name,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'shadow-tab-label',
            });
            label.hide();
            content.add_child(label);
            const button = new St.Button({
                child: content,
                style_class: 'shadow-tab',
                can_focus: true,
                reactive: true,
                track_hover: true,
                toggle_mode: true,
                accessible_name: meta.name,
            });
            button.connect('clicked', () => {
                this._onSelected(id);
                if (this._activeId === id)
                    button.checked = true;
            });
            button.connect('key-press-event', (_button, event) =>
                this._onKeyPress(id, event));
            this._box.add_child(button);
            this._buttons.set(id, {button, icon, label});
        }
    }

    setActive(id) {
        if (this._activeId === id) {
            const current = this._buttons.get(id);
            if (current)
                current.button.checked = true;
            return;
        }
        const hadActiveTab = this._activeId !== null;
        this._activeId = id;
        const animate = hadActiveTab && this._settings.get_boolean('animations');
        const accent = resolveAccent(this._settings);
        const tint = accentRgba(this._settings, 0.16);
        for (const [buttonId, {button, icon, label}] of this._buttons) {
            const active = buttonId === id;
            button.checked = active;
            button.accessible_name = active ? `${MODULE_META[buttonId].name}, selected` :
                MODULE_META[buttonId].name;
            label.remove_all_transitions();
            button.remove_style_class_name('shadow-tab-active');
            button.style = null;
            if (active) {
                button.add_style_class_name('shadow-tab-active');
                button.style = `background-color: ${tint};`;
                icon.style = `color: ${accent};`;
                label.show();
                label.opacity = animate ? 0 : 255;
                if (animate) {
                    const [, naturalWidth] = label.get_preferred_width(-1);
                    label.width = 0;
                    label.ease({
                        opacity: 255,
                        width: naturalWidth,
                        duration: 120,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            label.width = -1;
                        },
                    });
                } else {
                    label.width = -1;
                }
            } else if (label.visible && animate) {
                icon.style = null;
                label.ease({
                    opacity: 0,
                    width: 0,
                    duration: 80,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        label.hide();
                        label.width = -1;
                    },
                });
            } else {
                icon.style = null;
                label.hide();
                label.width = -1;
            }
        }
    }

    _onKeyPress(id, event) {
        const ids = [...this._buttons.keys()];
        const index = ids.indexOf(id);
        const key = event.get_key_symbol();
        let target = null;
        if (key === Clutter.KEY_Left || key === Clutter.KEY_Up)
            target = ids[(index - 1 + ids.length) % ids.length];
        else if (key === Clutter.KEY_Right || key === Clutter.KEY_Down)
            target = ids[(index + 1) % ids.length];
        else if (key === Clutter.KEY_Home)
            target = ids[0];
        else if (key === Clutter.KEY_End)
            target = ids.at(-1);
        if (!target)
            return Clutter.EVENT_PROPAGATE;
        this._onSelected(target);
        this._buttons.get(target)?.button.grab_key_focus();
        return Clutter.EVENT_STOP;
    }

    destroy() {
        this.actor.destroy();
        this._buttons.clear();
    }
}

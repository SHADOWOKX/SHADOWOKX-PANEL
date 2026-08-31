import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {MODULE_META} from '../lib/constants.js';
import {accentRgba, animationsEnabled, moduleIcon, resolveAccent} from './components.js';

export class TabStrip {
    constructor(extension, settings, moduleIds, onSelected) {
        this._settings = settings;
        this._onSelected = onSelected;
        this._buttons = new Map();
        this._activeId = null;
        this.actor = new St.BoxLayout({
            style_class: 'shadow-tab-strip shadow-segmented-control',
            x_expand: true,
        });
        this.actor.layout_manager.homogeneous = true;

        for (const id of moduleIds) {
            const meta = MODULE_META[id];
            const content = new St.BoxLayout({
                style_class: 'shadow-tab-content',
                y_align: Clutter.ActorAlign.CENTER,
            });
            const icon = moduleIcon(extension, id, 17, 'shadow-tab-icon');
            const label = new St.Label({
                text: meta.name,
                style_class: 'shadow-tab-label',
                y_align: Clutter.ActorAlign.CENTER,
            });
            content.add_child(icon);
            content.add_child(label);
            const button = new St.Button({
                child: new St.Bin({
                    child: content,
                    x_align: Clutter.ActorAlign.CENTER,
                }),
                style_class: 'shadow-tab shadow-segment',
                can_focus: true,
                reactive: true,
                track_hover: true,
                toggle_mode: true,
                accessible_name: meta.name,
                x_expand: true,
            });
            button.connect('clicked', () => {
                this._onSelected(id);
                button.checked = this._activeId === id;
            });
            button.connect('key-press-event', (_button, event) =>
                this._onKeyPress(id, event));
            this.actor.add_child(button);
            this._buttons.set(id, {button, content, icon, label});
        }
    }

    setActive(id) {
        if (!this._buttons.has(id))
            return;
        const previousId = this._activeId;
        const accent = resolveAccent(this._settings);
        const tint = accentRgba(this._settings, 0.16);

        for (const [buttonId, {button, content, icon, label}] of this._buttons) {
            const active = buttonId === id;
            button.checked = active;
            button.accessible_name = active
                ? `${MODULE_META[buttonId].name}, selected`
                : MODULE_META[buttonId].name;
            button.remove_style_class_name('shadow-tab-active');
            button.style = null;
            if (active) {
                button.add_style_class_name('shadow-tab-active');
                button.style = `background-color: ${tint};`;
                icon.style = `color: ${accent};`;
                if (previousId && previousId !== id && animationsEnabled(this._settings)) {
                    content.remove_all_transitions();
                    content.opacity = 210;
                    content.ease({
                        opacity: 255,
                        duration: 120,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                }
            } else {
                content.remove_all_transitions();
                content.opacity = 255;
                icon.style = null;
            }
            label.style = active ? `color: ${accent};` : null;
        }
        this._activeId = id;
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

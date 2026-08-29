import St from 'gi://St';

export class BasePage {
    constructor(context, id) {
        this.context = context;
        this.id = id;
        this._pageDestroyed = false;
        this.actor = new St.BoxLayout({
            vertical: true,
            style_class: `shadow-page shadow-page-${id}`,
            x_expand: true,
            y_expand: true,
        });
        this._disconnectors = [];
    }

    track(disconnector) {
        this._disconnectors.push(disconnector);
    }

    activate() {}

    onPopupOpened() {}

    onPopupClosed() {}

    replaceContent(build) {
        if (this._pageDestroyed || !this.actor)
            return false;

        const staging = new St.BoxLayout({vertical: true});
        try {
            build(staging);
        } catch (error) {
            staging.destroy();
            this.context.logger?.warn(`Could not render ${this.id} page`, error);
            return false;
        }

        const nextChildren = staging.get_children();
        for (const child of nextChildren)
            staging.remove_child(child);
        for (const child of this.actor.get_children())
            child.destroy();
        for (const child of nextChildren)
            this.actor.add_child(child);
        staging.destroy();
        return true;
    }

    destroy() {
        if (this._pageDestroyed)
            return;
        this._pageDestroyed = true;
        for (const disconnect of this._disconnectors.splice(0)) {
            try {
                disconnect();
            } catch {
                // A provider may already have been destroyed during extension teardown.
            }
        }
        this.actor?.destroy();
        this.actor = null;
    }
}

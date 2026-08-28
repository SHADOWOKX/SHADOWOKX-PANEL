import St from 'gi://St';

export class BasePage {
    constructor(context, id) {
        this.context = context;
        this.id = id;
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

    destroy() {
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

export class Observable {
    constructor(initialState = null) {
        this._state = initialState;
        this._listeners = new Set();
    }

    getState() {
        return this._state;
    }

    subscribe(callback) {
        this._listeners.add(callback);
        if (this._state !== null) {
            try {
                callback(this._state);
            } catch (error) {
                this._listeners.delete(callback);
                throw error;
            }
        }
        return () => this._listeners.delete(callback);
    }

    _setState(state) {
        this._state = state;
        for (const listener of this._listeners) {
            try {
                listener(state);
            } catch {
                console.error('[Shadow Panel] state listener failed');
            }
        }
    }

    destroy() {
        this._listeners.clear();
    }
}

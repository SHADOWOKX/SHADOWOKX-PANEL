export class Logger {
    constructor(settings) {
        this._settings = settings;
    }

    debug(event, details = {}) {
        if (!this._settings?.get_boolean('debug'))
            return;
        let serialized = '[unavailable]';
        try {
            serialized = JSON.stringify(this._sanitize(details));
        } catch {
            // Debug logging must never interfere with extension operation.
        }
        console.debug(`[Shadow Panel] ${event} ${serialized}`);
    }

    warn(event, error = null) {
        const rawMessage = error instanceof Error ? error.message : String(error ?? '');
        const message = this._redactText(rawMessage);
        console.warn(`[Shadow Panel] ${event}${message ? `: ${message}` : ''}`);
    }

    _redactText(value) {
        return String(value ?? '')
            .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
            .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]');
    }

    _sanitize(value, seen = new WeakSet(), depth = 0) {
        if (typeof value === 'string')
            return this._redactText(value);
        if (typeof value === 'bigint')
            return value.toString();
        if (!value || typeof value !== 'object')
            return value;
        if (depth >= 6)
            return '[max-depth]';
        if (seen.has(value))
            return '[circular]';
        seen.add(value);
        if (Array.isArray(value))
            return value.map(item => this._sanitize(item, seen, depth + 1));
        const result = {};
        for (const [key, item] of Object.entries(value)) {
            if (/token|secret|credential|authorization|cookie/i.test(key))
                result[key] = '[redacted]';
            else
                result[key] = this._sanitize(item, seen, depth + 1);
        }
        return result;
    }
}

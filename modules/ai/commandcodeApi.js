import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {CommandCodeError, commandCodeIdentity, decodeCommandCodeResponse, parseCommandCodeUsage, retryAfterTime,
    validateCommandCodeKey} from '../../lib/commandcodeUsage.js';

Gio._promisify(Soup.Session.prototype, 'send_async', 'send_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');
export const COMMANDCODE_API_INTERVAL = 180;
const BASE = 'https://api.commandcode.ai';
const ROUTES = ['/alpha/whoami', '/alpha/billing/credits', '/alpha/billing/subscriptions', '/alpha/usage/summary'];

// Injectable transport for offline tests. Production origin/routes cannot be configured.
export class CommandCodeApi {
    constructor({session = null, request = null, clock = () => Date.now(), timeoutMs = 15000} = {}) {
        this._session = session ?? new Soup.Session({timeout: 15});
        this._requestOverride = request;
        this._clock = clock;
        this._timeoutMs = timeoutMs;
        this._identity = null;
        this._keyDigest = null;
        this._optionalUnavailable = new Map();
        this._inFlight = null;
        this.retryAt = 0;
    }

    async _get(path, key, cancellable) {
        if (this._destroyed || cancellable?.is_cancelled()) throw new CommandCodeError('cancelled');
        if (!ROUTES.includes(path.split('?')[0])) throw new CommandCodeError('api-changed');
        let stream, message;
        const requestCancellation = new Gio.Cancellable();
        const parentCancellation = cancellable?.connect(() => requestCancellation.cancel()) ?? 0;
        let timedOut = false;
        let deadline = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._timeoutMs, () => {
            deadline = 0;
            timedOut = true;
            requestCancellation.cancel();
            return GLib.SOURCE_REMOVE;
        });
        try {
            let status, retry, raw;
            const headers = {Authorization: `Bearer ${key}`, Accept: 'application/json', 'User-Agent': 'commandcode-usage/1.0'};
            if (this._requestOverride) {
                const response = await this._requestOverride(path, key, requestCancellation, {method: 'GET', headers});
                ({status, retryAfter: retry, data: raw} = response);
                if (status === 200 && typeof response.body === 'string')
                    raw = decodeCommandCodeResponse(new TextEncoder().encode(response.body));
            } else {
                message = Soup.Message.new('GET', BASE + path);
                message.set_flags(Soup.MessageFlags.NO_REDIRECT);
                for (const [name, value] of Object.entries(headers)) message.request_headers.replace(name, value);
                stream = await this._session.send_async(message, GLib.PRIORITY_DEFAULT, requestCancellation);
                status = message.status_code;
                retry = message.response_headers.get_one('Retry-After');
                if (status === 200) {
                    const chunks = [];
                    let length = 0;
                    while (true) {
                        const bytes = (await stream.read_bytes_async(8192, GLib.PRIORITY_DEFAULT, requestCancellation)).toArray();
                        if (!bytes.length) break;
                        length += bytes.length;
                        if (length > 1024 * 1024) throw new CommandCodeError('api-changed');
                        chunks.push(bytes);
                    }
                    const output = new Uint8Array(length);
                    let offset = 0;
                    for (const bytes of chunks) { output.set(bytes, offset); offset += bytes.length; }
                    raw = decodeCommandCodeResponse(output);
                }
            }
            if (timedOut) throw new CommandCodeError('timeout');
            if (this._destroyed || cancellable?.is_cancelled()) throw new CommandCodeError('cancelled');
            if (status === 401 || status === 403) throw new CommandCodeError('authentication-failed');
            if (status === 429) {
                this.retryAt = Math.max(this.retryAt, retryAfterTime(retry, this._clock()));
                throw new CommandCodeError('rate-limited', this.retryAt);
            }
            if (status !== 200) {
                const error = new CommandCodeError(status >= 500 ? 'server' : 'api-changed');
                error.httpStatus = status;
                throw error;
            }
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CommandCodeError('api-changed');
            return raw;
        } catch (error) {
            if (error instanceof CommandCodeError) throw error;
            throw new CommandCodeError(this._destroyed || cancellable?.is_cancelled() ? 'cancelled' : timedOut ? 'timeout' : 'network');
        } finally {
            if (deadline) GLib.Source.remove(deadline);
            if (parentCancellation) cancellable.disconnect(parentCancellation);
            try { stream?.close(null); } catch { /* Never forward transport errors. */ }
            // Remove the credential from retained Soup message diagnostics.
            message?.request_headers.remove('Authorization');
        }
    }

    fetch(key, cancellable = null) {
        if (this._destroyed) return Promise.reject(new CommandCodeError('cancelled'));
        validateCommandCodeKey(key);
        const digest = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, key, -1);
        if (this._inFlight) return digest === this._inFlightDigest ? this._inFlight
            : Promise.reject(new CommandCodeError('cancelled'));
        this._inFlightDigest = digest;
        this._inFlight = this._fetch(key, cancellable).finally(() => { this._inFlight = null; });
        return this._inFlight;
    }

    async _fetch(key, cancellable) {
        validateCommandCodeKey(key);
        const now = this._clock();
        const digest = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, key, -1);
        if (digest !== this._keyDigest) {
            this._keyDigest = digest;
            this._identity = null;
            this._optionalUnavailable.clear();
            this.retryAt = 0;
        }
        if (this.retryAt > now) throw new CommandCodeError('rate-limited', this.retryAt);
        try {
            if (!this._identity || now - this._identity.checkedAt >= 900000) {
                const raw = await this._get(ROUTES[0], key, cancellable);
                const identity = commandCodeIdentity(raw); // Check before further requests.
                // Keep only the metadata actually needed; discard IDs/email/extra fields.
                this._identity = {raw: {user: {userName: identity.account},
                    org: identity.orgId ? {id: identity.orgId} : null}, checkedAt: now};
            }
            const credits = await this._get(ROUTES[1], key, cancellable);
            // Missing/changed mandatory data must not trigger optional requests.
            parseCommandCodeUsage(this._identity.raw, credits, null, null, now);
            const warnings = [];
            const optional = async path => {
                if ((this._optionalUnavailable.get(path.split('?')[0]) ?? 0) > now) {
                    warnings.push('api-changed');
                    return null;
                }
                try {
                    const raw = await this._get(path, key, cancellable);
                    const object = path.startsWith(ROUTES[2]) ? raw.data ?? raw.subscription : raw.data ?? raw;
                    const valid = object && typeof object === 'object' && !Array.isArray(object) &&
                        (path.startsWith(ROUTES[2]) ? typeof object.planId === 'string' || typeof object.plan_id === 'string'
                            : typeof object.totalCount === 'number' || typeof object.totalCredits === 'number');
                    if (!valid || raw.success === false) throw new CommandCodeError('api-changed');
                    return raw;
                }
                catch (error) {
                    if (error.code === 'authentication-failed' || error.code === 'cancelled') throw error;
                    if (error.httpStatus === 404)
                        this._optionalUnavailable.set(path.split('?')[0], now + 900000);
                    warnings.push(error.code);
                    return null;
                }
            };
            const reportedOrg = commandCodeIdentity(this._identity.raw).orgId;
            const orgId = reportedOrg && !reportedOrg.includes(key) ? reportedOrg : null;
            const subscription = await optional(ROUTES[2] + (orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''));
            // Stop issuing requests immediately after a server rate limit.
            const summary = this.retryAt > now ? null : await optional(ROUTES[3]);
            const data = parseCommandCodeUsage(this._identity.raw, credits, subscription, summary, this._clock());
            data.warnings = [...new Set(warnings)];
            data.retryAt = this.retryAt;
            // A server must not be able to reflect the supplied key into display fields.
            for (const field of ['account', 'plan', 'planId', 'planStatus'])
                if (data[field]?.includes(key)) data[field] = null;
            if (data.consumption.periodBasis?.includes(key)) data.consumption.periodBasis = null;
            return data;
        } catch (error) {
            if (error.code === 'authentication-failed') this._identity = null;
            throw error;
        }
    }

    destroy() { this._destroyed = true; this._session.abort(); this._identity = null; this._keyDigest = null; }
}

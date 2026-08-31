import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Observable} from '../../services/observable.js';
import {JsonStore} from '../../services/jsonStore.js';
import {APP_VERSION} from '../../lib/constants.js';
import {findCodexExecutable} from './discovery.js';
import {
    applyCodexHistory,
    mergeCodexHistory,
    normalizeCodexHistory,
    withoutCodexHistory,
} from './history.js';
import {normalizeCachedRateLimits, normalizeRateLimits} from './normalize.js';

Gio._promisify(Gio.OutputStream.prototype, 'write_all_async', 'write_all_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');

const MAX_MESSAGE_BYTES = 1024 * 1024;

export class CodexProvider extends Observable {
    constructor(settings, scheduler, logger) {
        super({
            status: 'loading',
            connection: 'unknown',
            stale: false,
            error: null,
            errorCode: null,
            fiveHour: null,
            weekly: null,
            resetCreditsAvailable: 0,
            tokenUsage: null,
            lastSuccessfulRefresh: null,
        });
        this._settings = settings;
        this._scheduler = scheduler;
        this._logger = logger;
        this._cache = new JsonStore(
            GLib.build_filenamev([GLib.get_user_cache_dir(), 'shadow-panel']),
            'codex.json',
            logger
        );
        this._historyStore = new JsonStore(
            GLib.build_filenamev([GLib.get_user_data_dir(), 'shadow-panel']),
            'codex-history.json',
            logger
        );
        this._history = normalizeCodexHistory(null);
        this._inFlight = null;
        this._cancellable = null;
        this._process = null;
        this._settingsId = 0;
        this._destroyed = false;
    }

    async start() {
        const [cached, history] = await Promise.all([
            this._cache.read(null),
            this._historyStore.read(null),
        ]);
        if (this._destroyed)
            return this.getState();
        this._history = normalizeCodexHistory(history);
        const cachedState = normalizeCachedRateLimits(cached);
        if (cachedState) {
            const stale = Date.now() - cachedState.lastSuccessfulRefresh >=
                this._settings.get_int('codex-refresh-minutes') * 60 * 1000;
            this._setState({
                ...cachedState,
                tokenUsage: applyCodexHistory(cachedState.tokenUsage, this._history),
                status: stale ? 'stale' : 'cached',
                stale,
            });
        }
        this._reschedule();
        this._settingsId = this._settings.connect('changed::codex-refresh-minutes', () => {
            this._reschedule();
            this.refresh(false);
        });
        return this.refresh(false);
    }

    _reschedule() {
        const seconds = this._settings.get_int('codex-refresh-minutes') * 60;
        this._scheduler.every('codex-refresh', seconds, () => this.refresh(false));
    }

    refresh(force = true) {
        if (this._destroyed)
            return Promise.resolve(this.getState());
        if (this._inFlight)
            return this._inFlight;
        if (!force && !this.isStale())
            return Promise.resolve(this.getState());

        this._inFlight = this._refresh()
            .finally(() => {
                this._inFlight = null;
            });
        return this._inFlight;
    }

    isStale() {
        const current = this.getState();
        if (current?.status === 'stale' || current?.status === 'error' ||
            current?.connection === 'unavailable')
            return true;
        const last = current?.lastSuccessfulRefresh;
        const maxAge = this._settings.get_int('codex-refresh-minutes') * 60 * 1000;
        return !last || Date.now() - last >= maxAge;
    }

    async _refresh() {
        const previous = this.getState();
        this._setState({
            ...previous,
            status: previous?.lastSuccessfulRefresh ? 'refreshing' : 'loading',
            error: null,
        });

        try {
            const response = await this._readAppServer();
            const nowMs = Date.now();
            let liveState;
            try {
                liveState = normalizeRateLimits(response.rateLimitsResponse, nowMs, {
                    usageResponse: response.usageResponse,
                });
            } catch {
                throw new Error('codex-invalid-response');
            }
            this._history = mergeCodexHistory(this._history, liveState.tokenUsage, nowMs);
            const state = {
                ...liveState,
                tokenUsage: applyCodexHistory(liveState.tokenUsage, this._history, nowMs),
            };
            if (this._destroyed)
                return this.getState();
            this._setState(state);
            try {
                await Promise.all([
                    this._cache.write({
                        ...state,
                        tokenUsage: withoutCodexHistory(state.tokenUsage),
                    }),
                    this._historyStore.write(this._history),
                ]);
            } catch {
                this._logger?.debug('codex.storage.write.failed');
            }
            this._logger?.debug('codex.refresh.success', {
                hasFiveHour: Boolean(state.fiveHour),
                hasWeekly: Boolean(state.weekly),
            });
            return state;
        } catch (error) {
            if (this._destroyed ||
                error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                return this.getState();
            }
            const hasCache = Boolean(previous?.lastSuccessfulRefresh);
            const details = this._friendlyError(error);
            const state = {
                ...previous,
                status: hasCache ? 'stale' : 'error',
                connection: 'unavailable',
                stale: hasCache,
                errorCode: details.code,
                error: details.message,
            };
            this._setState(state);
            this._logger?.debug('codex.refresh.failed', {message: error.message});
            return state;
        }
    }

    async _readAppServer() {
        const executable = this._findCodex();
        if (!executable)
            throw new Error('codex-not-installed');

        this._cancellable = new Gio.Cancellable();
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDIN_PIPE |
                Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.SubprocessFlags.STDERR_SILENCE,
        });
        this._process = launcher.spawnv([executable, 'app-server', '--stdio']);

        const initializeRequest = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                clientInfo: {
                    name: 'shadow-panel',
                    title: 'Shadowokx Panel',
                    version: APP_VERSION,
                },
                capabilities: {
                    experimentalApi: false,
                    requestAttestation: false,
                },
            },
        };

        let timedOut = false;
        const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
            timedOut = true;
            this._cancellable?.cancel();
            try {
                this._process?.force_exit();
            } catch {
                // The process may complete at the timeout boundary.
            }
            return GLib.SOURCE_REMOVE;
        });
        let initializeResponse = null;
        let usageResponse = null;
        let usageSettled = false;
        let rateLimitsResponse = null;

        try {
            const output = this._process.get_stdin_pipe();
            const input = this._process.get_stdout_pipe();
            let buffered = new Uint8Array(0);
            const writeMessages = messages => output.write_all_async(
                new TextEncoder().encode(messages.map(JSON.stringify).join('\n') + '\n'),
                GLib.PRIORITY_DEFAULT,
                this._cancellable
            );
            const readLine = async () => {
                while (true) {
                    const newline = buffered.indexOf(10);
                    if (newline >= 0) {
                        let line = buffered.slice(0, newline);
                        buffered = buffered.slice(newline + 1);
                        if (line.at(-1) === 13)
                            line = line.slice(0, -1);
                        return new TextDecoder().decode(line);
                    }
                    if (buffered.length >= MAX_MESSAGE_BYTES)
                        throw new Error('codex-invalid-response');
                    const bytes = await input.read_bytes_async(
                        Math.min(64 * 1024, MAX_MESSAGE_BYTES + 1 - buffered.length),
                        GLib.PRIORITY_DEFAULT,
                        this._cancellable
                    );
                    const data = bytes.get_data();
                    if (!data?.length) {
                        if (!buffered.length)
                            return null;
                        const finalLine = new TextDecoder().decode(buffered);
                        buffered = new Uint8Array(0);
                        return finalLine;
                    }
                    const combined = new Uint8Array(buffered.length + data.length);
                    combined.set(buffered);
                    combined.set(data, buffered.length);
                    buffered = combined;
                    if (buffered.length > MAX_MESSAGE_BYTES)
                        throw new Error('codex-invalid-response');
                }
            };
            const readMessage = async () => {
                for (let count = 0; count < 512; count++) {
                    const line = await readLine();
                    if (timedOut)
                        throw new Error('codex-timeout');
                    if (!line)
                        throw new Error('codex-invalid-response');
                    try {
                        return JSON.parse(line);
                    } catch {
                        // Ignore a non-JSON diagnostic line from the local process.
                    }
                }
                throw new Error('codex-invalid-response');
            };

            await writeMessages([initializeRequest]);

            for (let count = 0; count < 512 && !initializeResponse; count++) {
                const message = await readMessage();
                if (message.id === 1) {
                    if (message.error || !message.result)
                        throw new Error('codex-request-failed');
                    initializeResponse = message.result;
                }
            }
            if (!initializeResponse)
                throw new Error('codex-invalid-response');

            await writeMessages([
                {jsonrpc: '2.0', method: 'initialized'},
                {
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'account/usage/read',
                    params: {},
                },
                {
                    jsonrpc: '2.0',
                    id: 3,
                    method: 'account/rateLimits/read',
                },
            ]);

            for (let count = 0; count < 512; count++) {
                const message = await readMessage();
                if (message.id === 2) {
                    usageSettled = true;
                    if (!message.error)
                        usageResponse = message.result ?? null;
                }
                if (message.id === 3) {
                    if (message.error)
                        throw new Error('codex-request-failed');
                    if (!message.result)
                        throw new Error('codex-invalid-response');
                    rateLimitsResponse = message.result;
                }
                // Account metadata is optional. Token activity is also optional,
                // but wait for its response so out-of-order JSON-RPC messages do
                // not incorrectly look like an unsupported Codex version.
                if (rateLimitsResponse && usageSettled) {
                    return {
                        initializeResponse,
                        rateLimitsResponse,
                        usageResponse,
                    };
                }
            }
            throw new Error('codex-invalid-response');
        } catch (error) {
            // A non-compliant older server may ignore the optional usage method.
            // Preserve a valid rate-limit response at the global timeout.
            if (timedOut && rateLimitsResponse) {
                return {
                    initializeResponse,
                    rateLimitsResponse,
                    usageResponse: null,
                };
            }
            if (timedOut)
                throw new Error('codex-timeout');
            throw error;
        } finally {
            if (!timedOut)
                GLib.Source.remove(timeoutId);
            try {
                this._process?.force_exit();
            } catch {
                // The subprocess may already have exited after a protocol error.
            }
            this._process = null;
            this._cancellable = null;
        }
    }

    _findCodex() {
        return findCodexExecutable();
    }

    _friendlyError(error) {
        switch (error.message) {
        case 'codex-not-installed':
            return {
                code: 'not-installed',
                message: 'Install Codex for this user, then sign in and retry.',
            };
        case 'codex-timeout':
            return {code: 'timeout', message: 'Codex did not respond in time.'};
        case 'codex-request-failed':
            return {
                code: 'usage-unavailable',
                message: 'Open Codex and confirm you are signed in, then retry.',
            };
        case 'codex-invalid-response':
            return {
                code: 'unsupported-response',
                message: 'This Codex version did not return supported usage data.',
            };
        default:
            return {
                code: 'unavailable',
                message: 'Codex usage is temporarily unavailable.',
            };
        }
    }

    destroy() {
        this._destroyed = true;
        if (this._settingsId)
            this._settings.disconnect(this._settingsId);
        this._settingsId = 0;
        this._cancellable?.cancel();
        try {
            this._process?.force_exit();
        } catch {
            // The process may already have exited while the extension was disabling.
        }
        this._scheduler.cancel('codex-refresh');
        super.destroy();
    }
}

import {CodexProvider} from '../modules/codex/provider.js';

const settings = {
    get_int() {
        return 15;
    },
    connect() {
        return 1;
    },
    disconnect() {},
};

const scheduler = {
    every() {},
    cancel() {},
};

const logger = {
    debug(event, details) {
        if (event === 'codex.refresh.failed')
            printerr(`Codex provider diagnostic: ${details.message}`);
    },
};

const provider = new CodexProvider(settings, scheduler, logger);
await provider.start();
const state = await provider.refresh(true);
print(JSON.stringify({
    status: state.status,
    source: state.source ?? null,
    connection: state.connection,
    plan: state.planLabel ?? null,
    fiveHourAvailable: Boolean(state.fiveHour),
    weeklyAvailable: Boolean(state.weekly),
    todayTokens: state.tokenUsage?.todayTokens ?? null,
    lifetimeTokens: state.tokenUsage?.lifetimeTokens ?? null,
    peakDay: state.tokenUsage?.peakDate ?? null,
    peakHourAvailable: Boolean(state.tokenUsage?.peakHour),
    resetCreditsAvailable: state.resetCreditsAvailable ?? 0,
    clientVersion: state.clientVersion ?? null,
    error: state.error ?? null,
}, null, 2));
provider.destroy();

import {CommandCodeError, validateCommandCodeKey} from '../../lib/commandcodeUsage.js';

let modulePromise;
async function backend() {
    try {
        modulePromise ??= import('gi://Secret?version=1');
        const {default: Secret} = await modulePromise;
        const schema = new Secret.Schema('org.gnome.shell.extensions.shadow-panel.CommandCode',
            Secret.SchemaFlags.NONE, {application: Secret.SchemaAttributeType.STRING, provider: Secret.SchemaAttributeType.STRING});
        return {Secret, schema};
    } catch { throw new CommandCodeError('keyring-unavailable'); }
}
const attributes = {application: 'shadow-panel', provider: 'commandcode'};

// Background reads never request UNLOCK, so polling cannot repeatedly show prompts.
export async function lookupCommandCodeKey(cancellable = null) {
    const {Secret, schema} = await backend();
    try {
        const service = await new Promise((resolve, reject) => Secret.Service.get(Secret.ServiceFlags.OPEN_SESSION,
            cancellable, (_source, result) => {
                try { resolve(Secret.Service.get_finish(result)); } catch (error) { reject(error); }
            }));
        const items = await new Promise((resolve, reject) => service.search(schema, attributes,
            Secret.SearchFlags.ALL | Secret.SearchFlags.LOAD_SECRETS, cancellable, (_source, result) => {
                try { resolve(service.search_finish(result)); } catch (error) { reject(error); }
            }));
        if (!items.length) return null;
        if (items.some(item => item.get_locked())) throw new CommandCodeError('keyring-locked');
        const value = items[0].get_secret()?.get_text();
        return value ? validateCommandCodeKey(value) : null;
    } catch (error) {
        if (error instanceof CommandCodeError) throw error;
        throw new CommandCodeError(cancellable?.is_cancelled() ? 'cancelled' : 'keyring-unavailable');
    }
}

export async function storeCommandCodeKey(key, cancellable = null) {
    validateCommandCodeKey(key);
    const {Secret, schema} = await backend();
    try {
        const saved = await new Promise((resolve, reject) => Secret.password_store(schema, attributes,
            Secret.COLLECTION_DEFAULT, 'SHADOWOKX Panel · Command Code API key', key, cancellable, (_source, result) => {
                try { resolve(Secret.password_store_finish(result)); } catch (error) { reject(error); }
            }));
        if (!saved) throw new Error();
    } catch { throw new CommandCodeError(cancellable?.is_cancelled() ? 'cancelled' : 'keyring-write-failed'); }
}

export async function clearCommandCodeKey(cancellable = null) {
    const {Secret, schema} = await backend();
    try {
        await new Promise((resolve, reject) => Secret.password_clear(schema, attributes, cancellable, (_source, result) => {
            try { resolve(Secret.password_clear_finish(result)); } catch (error) { reject(error); }
        }));
    } catch { throw new CommandCodeError(cancellable?.is_cancelled() ? 'cancelled' : 'keyring-unavailable'); }
}

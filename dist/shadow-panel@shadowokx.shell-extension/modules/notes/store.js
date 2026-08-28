import GLib from 'gi://GLib';

import {Observable} from '../../services/observable.js';
import {JsonStore} from '../../services/jsonStore.js';

export const MAX_NOTES = 500;

function truncateNoteText(value) {
    return [...String(value ?? '').trim()].slice(0, 2000).join('');
}

export function normalizeNotes(value) {
    if (!Array.isArray(value))
        return [];
    const seenIds = new Set();
    return value
        .filter(item => item && typeof item === 'object' &&
            typeof item.id === 'string' && item.id.length <= 100 &&
            typeof item.text === 'string' && !seenIds.has(item.id) && seenIds.add(item.id))
        .map(item => ({
            id: item.id,
            text: truncateNoteText(item.text),
            pinned: Boolean(item.pinned),
            createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
            updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
        }))
        .filter(item => item.text.length > 0)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
        .slice(0, MAX_NOTES);
}

export class NoteStore extends Observable {
    constructor(logger) {
        super([]);
        this._store = new JsonStore(
            GLib.build_filenamev([GLib.get_user_data_dir(), 'shadow-panel']),
            'notes.json',
            logger,
            5 * 1024 * 1024
        );
        this._mutationQueue = Promise.resolve();
        this._status = 'loading';
        this._error = null;
        this._readHealthy = false;
        this._startPromise = null;
    }

    start() {
        if (this._startPromise)
            return this._startPromise;
        this._startPromise = this._start().finally(() => {
            this._startPromise = null;
        });
        return this._startPromise;
    }

    async _start() {
        this._status = 'loading';
        this._error = null;
        this._readHealthy = false;
        const rawNotes = await this._store.read([]);
        const notes = normalizeNotes(rawNotes);
        if (this._store.lastReadError) {
            this._status = 'error';
            this._error = 'Notes could not be read. The original file was left untouched.';
        } else if (!Array.isArray(rawNotes)) {
            this._status = 'error';
            this._error = 'Notes storage has an invalid format. The original file was left untouched.';
        } else if (rawNotes.length > MAX_NOTES) {
            this._status = 'error';
            this._error = `Notes exceed the safe ${MAX_NOTES}-item limit. The original file was left untouched.`;
        } else if (notes.length !== rawNotes.length) {
            this._status = 'error';
            this._error = 'Notes contain invalid or duplicate records. The original file was left untouched.';
        } else {
            this._status = 'success';
            this._readHealthy = true;
        }
        this._setState(notes);
        return notes;
    }

    getStatus() {
        return {status: this._status, error: this._error, canMutate: this._readHealthy};
    }

    add(text) {
        const cleanText = truncateNoteText(text);
        if (!cleanText)
            return Promise.resolve(false);
        const now = Date.now();
        return this._mutate(notes => {
            if (notes.length >= MAX_NOTES)
                throw new Error(`Quick Notes is limited to ${MAX_NOTES} items`);
            return [{
                id: GLib.uuid_string_random(),
                text: cleanText,
                pinned: false,
                createdAt: now,
                updatedAt: now,
            }, ...notes];
        });
    }

    update(id, text) {
        const cleanText = truncateNoteText(text);
        if (!cleanText)
            return Promise.resolve(false);
        return this._mutate(notes => notes.map(note => note.id === id
            ? {...note, text: cleanText, updatedAt: Date.now()}
            : note));
    }

    togglePinned(id) {
        return this._mutate(notes => notes.map(note => note.id === id
            ? {...note, pinned: !note.pinned, updatedAt: Date.now()}
            : note));
    }

    remove(id) {
        return this._mutate(notes => notes.filter(note => note.id !== id));
    }

    _mutate(transform) {
        if (!this._readHealthy)
            return Promise.reject(new Error('Notes are read-only until the storage problem is resolved'));
        const operation = this._mutationQueue.then(async () => {
            const transformed = transform(this.getState());
            if (!Array.isArray(transformed) || transformed.length > MAX_NOTES)
                throw new Error(`Quick Notes is limited to ${MAX_NOTES} items`);
            const next = normalizeNotes(transformed);
            await this._store.write(next);
            this._status = 'success';
            this._error = null;
            this._setState(next);
            return true;
        }).catch(error => {
            this._status = 'error';
            this._error = 'The note change could not be saved. Existing data is unchanged.';
            this._setState(this.getState());
            throw error;
        });
        this._mutationQueue = operation.catch(() => {});
        return operation;
    }
}

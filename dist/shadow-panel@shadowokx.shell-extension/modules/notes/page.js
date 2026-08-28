import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {BasePage} from '../basePage.js';
import {
    clearChildren,
    contrastForeground,
    iconButton,
    pageTitle,
    resolveAccent,
    scrollContainer,
    stateMessage,
    textButton,
} from '../../ui/components.js';

export class NotesPage extends BasePage {
    constructor(context) {
        super(context, 'notes');
        this._store = context.noteStore;
        this._obsidian = context.obsidianService;
        const transient = context.notesTransientState ?? {};
        this._editor = transient.editor?.id && typeof transient.editor.text === 'string'
            ? {id: transient.editor.id, text: transient.editor.text}
            : null;
        this._captureText = typeof transient.captureText === 'string'
            ? [...transient.captureText].slice(0, 2000).join('')
            : '';
        this._notice = null;
        this._saving = false;
        this._exportingNotes = new Set();
        this.track(this._store.subscribe(() => this._render()));
        this.track(this._obsidian.subscribe(() => this._render()));
        const saveModeId = context.settings.connect('changed::notes-save-mode', () => this._render());
        this.track(() => context.settings.disconnect(saveModeId));
    }

    _render() {
        if (!this.actor)
            return;
        clearChildren(this.actor);
        const obsidianState = this._obsidian.getState();
        const titleActions = new St.BoxLayout({style_class: 'shadow-title-actions'});
        if (obsidianState.status === 'ready') {
            titleActions.add_child(iconButton('folder-open-symbolic', 'Open Obsidian target folder', () =>
                this._openVaultFolder()));
            titleActions.add_child(iconButton('external-link-symbolic', 'Open Obsidian', () =>
                this._openObsidian()));
        }
        this.actor.add_child(pageTitle('Notes', titleActions));

        const storeStatus = this._store.getStatus();
        if (storeStatus.status === 'loading') {
            this.actor.add_child(stateMessage(
                'content-loading-symbolic',
                'Loading notes',
                'Reading local Quick Notes…'
            ));
            return;
        }
        if (storeStatus.status === 'error' && this._store.getState().length === 0) {
            this.actor.add_child(stateMessage(
                'dialog-warning-symbolic',
                'Notes unavailable',
                storeStatus.error,
                textButton('Retry', () => this._store.start())
            ));
            return;
        }

        const body = new St.BoxLayout({vertical: true, style_class: 'shadow-notes-body'});
        body.add_child(this._buildVaultCard(obsidianState));
        if (this._notice) {
            const notice = new St.Label({
                text: this._notice.text,
                style_class: this._notice.error ? 'shadow-inline-error' : 'shadow-inline-success',
            });
            notice.clutter_text.set_line_wrap(true);
            body.add_child(notice);
        } else if (storeStatus.status === 'error') {
            const warning = new St.BoxLayout({style_class: 'shadow-inline-error', x_expand: true});
            const warningText = new St.Label({
                text: storeStatus.error,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            warningText.clutter_text.set_line_wrap(true);
            warning.add_child(warningText);
            warning.add_child(textButton('Retry', () => this._store.start(),
                'shadow-text-button shadow-secondary-button'));
            body.add_child(warning);
        }

        if (storeStatus.canMutate) {
            body.add_child(this._buildCapture(obsidianState));
            if (this._editor)
                body.add_child(this._buildEditor());
        } else {
            this._editor = null;
        }

        const notes = this._store.getState();
        const list = new St.BoxLayout({vertical: true, style_class: 'shadow-item-list'});
        if (notes.length === 0) {
            list.add_child(new St.Label({
                text: 'No local notes yet. Capture one above.',
                style_class: 'shadow-empty-list',
            }));
        } else {
            const pinned = notes.filter(note => note.pinned);
            const recent = notes.filter(note => !note.pinned);
            if (pinned.length) {
                list.add_child(new St.Label({text: 'Pinned', style_class: 'shadow-list-heading'}));
                for (const note of pinned)
                    list.add_child(this._buildNote(note, obsidianState, !storeStatus.canMutate));
            }
            if (recent.length) {
                list.add_child(new St.Label({text: 'Recent', style_class: 'shadow-list-heading'}));
                for (const note of recent)
                    list.add_child(this._buildNote(note, obsidianState, !storeStatus.canMutate));
            }
        }
        body.add_child(list);

        const mode = this.context.settings.get_string('notes-save-mode');
        const destinations = {
            local: 'Local by default',
            obsidian: 'Obsidian by default',
            both: 'Local + Obsidian by default',
        };
        body.add_child(new St.Label({
            text: notes.length + (notes.length === 1 ? ' local note · ' : ' local notes · ') +
                (destinations[mode] ?? destinations.local),
            style_class: 'shadow-summary-row shadow-muted',
            x_align: Clutter.ActorAlign.START,
        }));
        this.actor.add_child(scrollContainer(body, 'shadow-notes-page-scroll'));
    }

    getTransientState() {
        return {
            captureText: this._captureText,
            editor: this._editor
                ? {id: this._editor.id, text: this._editor.text}
                : null,
        };
    }

    _buildVaultCard(state) {
        const card = new St.BoxLayout({style_class: 'shadow-vault-card', x_expand: true});
        card.add_child(new St.Bin({
            style_class: 'shadow-vault-icon',
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: state.status === 'ready'
                    ? 'folder-documents-symbolic'
                    : state.status === 'error' ? 'dialog-warning-symbolic' : 'folder-symbolic',
                icon_size: 20,
            }),
        }));
        const copy = new St.BoxLayout({vertical: true, style_class: 'shadow-vault-copy', x_expand: true});
        if (state.status === 'ready') {
            const title = new St.Label({text: state.vaultName, style_class: 'shadow-vault-title'});
            const path = new St.Label({
                text: state.targetFolder,
                style_class: 'shadow-vault-path',
            });
            for (const label of [title, path]) {
                label.clutter_text.set_single_line_mode(true);
                label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            }
            copy.add_child(title);
            copy.add_child(path);
        } else if (state.status === 'checking') {
            copy.add_child(new St.Label({text: 'Checking Obsidian vault…', style_class: 'shadow-vault-title'}));
            copy.add_child(new St.Label({text: 'Validating the configured destination', style_class: 'shadow-muted'}));
        } else if (state.status === 'error') {
            copy.add_child(new St.Label({text: 'Obsidian needs attention', style_class: 'shadow-vault-title'}));
            copy.add_child(new St.Label({text: state.error, style_class: 'shadow-vault-path'}));
        } else {
            copy.add_child(new St.Label({text: 'Obsidian not connected', style_class: 'shadow-vault-title'}));
            copy.add_child(new St.Label({text: 'Local Quick Notes remain available', style_class: 'shadow-muted'}));
        }
        card.add_child(copy);
        if (state.status !== 'ready') {
            card.add_child(iconButton('emblem-system-symbolic', 'Configure Obsidian', () =>
                this.context.extension.openPreferences()));
        }
        return card;
    }

    _buildCapture(obsidianState) {
        const box = new St.BoxLayout({vertical: true, style_class: 'shadow-capture-card'});
        box.add_child(new St.Label({text: 'Quick capture', style_class: 'shadow-section-title'}));
        const entry = new St.Entry({
            text: this._captureText,
            hint_text: 'Capture a thought, command, or follow-up…',
            style_class: 'shadow-entry shadow-capture-entry',
            can_focus: !this._saving,
            reactive: !this._saving,
            x_expand: true,
        });
        entry.clutter_text.editable = !this._saving;
        if (this._saving)
            entry.opacity = 150;
        entry.connect('notify::text', () => {
            this._captureText = entry.get_text();
        });
        entry.clutter_text.set_max_length(2000);
        box.add_child(entry);

        const actions = new St.BoxLayout({style_class: 'shadow-capture-actions', x_expand: true});
        const mode = this.context.settings.get_string('notes-save-mode');
        const labels = {
            local: 'Save locally',
            obsidian: 'Save to Obsidian',
            both: 'Save both',
        };
        const primary = textButton(this._saving ? 'Saving…' : labels[mode] ?? labels.local, () =>
            this._saveCapture(mode), 'shadow-primary-button');
        primary.reactive = !this._saving;
        primary.can_focus = !this._saving;
        if (this._saving)
            primary.opacity = 150;
        const accent = resolveAccent(this.context.settings);
        primary.set_style(`background-color: ${accent}; color: ${contrastForeground(accent)};`);
        actions.add_child(primary);
        if (!this._saving && mode === 'local' && obsidianState.status === 'ready') {
            actions.add_child(textButton('To Obsidian', () =>
                this._saveCapture('obsidian'), 'shadow-text-button shadow-secondary-button'));
        }
        box.add_child(actions);
        entry.clutter_text.connect('activate', () => this._saveCapture(mode));
        return box;
    }

    async _saveCapture(mode) {
        const value = this._captureText.trim();
        if (!value || this._saving)
            return;
        this._saving = true;
        this._notice = null;
        this._render();
        try {
            const operations = [];
            if (mode === 'local' || mode === 'both')
                operations.push({destination: 'local', promise: this._store.add(value)});
            if (mode === 'obsidian' || mode === 'both')
                operations.push({destination: 'obsidian', promise: this._obsidian.save(value)});
            const results = await Promise.allSettled(operations.map(operation => operation.promise));
            const succeeded = operations
                .filter((_operation, index) => results[index].status === 'fulfilled')
                .map(operation => operation.destination);
            const failed = operations
                .filter((_operation, index) => results[index].status === 'rejected')
                .map(operation => operation.destination);
            if (succeeded.length && this._captureText.trim() === value)
                this._captureText = '';
            if (!failed.length) {
                this._notice = {
                    error: false,
                    text: mode === 'both'
                        ? 'Saved locally and to Obsidian.'
                        : mode === 'obsidian' ? 'Saved to Obsidian.' : 'Saved locally.',
                };
            } else if (succeeded.includes('local')) {
                this._notice = {error: true, text: 'Saved locally, but Obsidian saving failed.'};
            } else if (succeeded.includes('obsidian')) {
                this._notice = {error: true, text: 'Saved to Obsidian, but the local save failed.'};
            } else {
                this._notice = {
                    error: true,
                    text: failed.includes('obsidian')
                        ? this._obsidian.getState().error ?? 'The note could not be saved.'
                        : this._store.getStatus().error ?? 'The note could not be saved locally.',
                };
            }
        } finally {
            this._saving = false;
            this._render();
        }
    }

    _buildEditor() {
        const editor = this._editor;
        const isSaving = Boolean(editor.saving);
        const box = new St.BoxLayout({vertical: true, style_class: 'shadow-editor'});
        const entry = new St.Entry({
            text: editor.text,
            hint_text: 'Edit local note…',
            style_class: 'shadow-entry',
            can_focus: !isSaving,
            reactive: !isSaving,
            x_expand: true,
        });
        entry.clutter_text.editable = !isSaving;
        if (isSaving)
            entry.opacity = 150;
        entry.clutter_text.set_max_length(2000);
        entry.connect('notify::text', () => {
            if (this._editor?.id === editor.id)
                this._editor.text = entry.get_text();
        });
        box.add_child(entry);
        const actions = new St.BoxLayout({style_class: 'shadow-editor-actions', x_align: Clutter.ActorAlign.END});
        const cancel = textButton('Cancel', () => {
            this._editor = null;
            this._render();
        }, 'shadow-text-button shadow-secondary-button');
        cancel.reactive = !isSaving;
        cancel.can_focus = !isSaving;
        actions.add_child(cancel);
        const save = () => {
            const value = entry.get_text().trim();
            if (!value || editor.saving)
                return;
            editor.saving = true;
            this._render();
            this._store.update(editor.id, value)
                .then(() => {
                    if (this._editor?.id === editor.id)
                        this._editor = null;
                    this._render();
                })
                .catch(error => {
                    this.context.logger.warn('Could not save note', error);
                    if (this._editor?.id === editor.id)
                        this._editor.saving = false;
                    this._notice = {error: true, text: this._store.getStatus().error};
                    this._render();
                });
        };
        const saveButton = textButton(isSaving ? 'Saving…' : 'Save', save, 'shadow-primary-button');
        saveButton.reactive = !isSaving;
        saveButton.can_focus = !isSaving;
        actions.add_child(saveButton);
        box.add_child(actions);
        entry.clutter_text.connect('activate', save);
        return box;
    }

    _buildNote(note, obsidianState, readOnly = false) {
        const row = new St.BoxLayout({style_class: 'shadow-item-row shadow-note-row', x_expand: true});
        const label = new St.Label({
            text: note.text,
            style_class: 'shadow-item-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        label.clutter_text.set_line_wrap(true);
        row.add_child(label);
        if (obsidianState.status === 'ready') {
            row.add_child(iconButton('send-to-symbolic', 'Save note to Obsidian', () =>
                this._exportNote(note)));
        }
        row.add_child(iconButton('edit-copy-symbolic', 'Copy note', () => {
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, note.text);
        }));
        if (!readOnly) {
            row.add_child(iconButton(
                note.pinned ? 'starred-symbolic' : 'non-starred-symbolic',
                note.pinned ? 'Unpin note' : 'Pin note',
                () => this._runLocalMutation(this._store.togglePinned(note.id), 'pin note')
            ));
            row.add_child(iconButton('document-edit-symbolic', 'Edit note', () => {
                this._editor = {id: note.id, text: note.text, saving: false};
                this._render();
            }));
            row.add_child(iconButton('user-trash-symbolic', 'Delete note', () =>
                this._runLocalMutation(this._store.remove(note.id), 'delete note'),
            'shadow-icon-button shadow-destructive-button'));
        }
        return row;
    }

    async _exportNote(note) {
        if (this._exportingNotes.has(note.id))
            return;
        this._exportingNotes.add(note.id);
        try {
            await this._obsidian.save(note.text);
            this._notice = {error: false, text: 'Saved to Obsidian.'};
        } catch {
            this._notice = {
                error: true,
                text: this._obsidian.getState().error ?? 'The note could not be saved to Obsidian.',
            };
        } finally {
            this._exportingNotes.delete(note.id);
            this._render();
        }
    }

    _runLocalMutation(promise, action) {
        promise.catch(error => {
            this.context.logger.warn(`Could not ${action}`, error);
            this._notice = {
                error: true,
                text: this._store.getStatus().error ?? `The note could not ${action}.`,
            };
            this._render();
        });
    }

    _openVaultFolder() {
        this._obsidian.openVaultFolder().catch(() => {
            this._notice = {error: true, text: this._obsidian.getState().error};
            this._render();
        });
    }

    _openObsidian() {
        this._obsidian.openObsidian().catch(() => {
            this._notice = {error: true, text: 'Obsidian could not be opened.'};
            this._render();
        });
    }
}

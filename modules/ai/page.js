import Gio from 'gi://Gio';
import St from 'gi://St';
import {BasePage} from '../basePage.js';
import {MODULE_META} from '../../lib/constants.js';
import {COMMANDCODE_USAGE_URL, GOAT_REFERENCE} from '../../lib/commandcodeReference.js';
import {formatCountdown, formatRelativeAge} from '../../lib/format.js';
import {commandCodeView} from './commandcodeView.js';
import {animationsEnabled, fitScrollToContent, iconButton, moduleIcon, pageTitle, ProgressMeter, resolveAccent,
    scrollContainer, stateMessage, textButton, moduleIconButton} from '../../ui/components.js';

export class AIPage extends BasePage {
    constructor(context, id) {
        super(context, id);
        this._provider = context.aiProviders.get(id);
        this._lastCommandCodeRemaining = null;
        this.track(this._provider.subscribe(state => this._render(state)));
        if (id === 'commandcode' && context.scheduler) {
            const name = 'commandcode-countdown';
            context.scheduler.every(name, 30, () => {
                if (!this.actor?.mapped || this._provider.getState().data?.source !== 'commandcode-api') return;
                this._lastSignature = null;
                this._render(this._provider.getState());
            });
            this.track(() => context.scheduler.cancel(name));
        }
    }

    activate() { this._provider.refresh(false); }
    onPopupOpened() { this._provider.refresh(false); }
    fit() { fitScrollToContent(this._scroll, this._body, this.context, this.actor); }

    _render(state) {
        const signature = JSON.stringify(state);
        if (signature === this._lastSignature) return;
        this._lastSignature = signature;
        this.replaceContent(root => {
            const native = this.id === 'commandcode' && state.data?.source === 'commandcode-api';
            let actions;
            if (native) {
                actions = new St.BoxLayout({style_class: 'shadow-title-actions'});
                actions.add_child(moduleIconButton(this.context.extension, 'commandcode', 'Open CommandCode Usage',
                    () => this._openCommandCodeUsage(), 'shadow-icon-button shadow-action-icon-button'));
                const refresh = iconButton(state.refreshing ? 'process-working-symbolic' : 'view-refresh-symbolic',
                    'Refresh usage', () => this._provider.refresh(), 'shadow-icon-button shadow-action-icon-button');
                refresh.reactive = !state.refreshing;
                refresh.can_focus = !state.refreshing;
                actions.add_child(refresh);
                actions.add_child(iconButton('emblem-system-symbolic', 'Command Code settings',
                    () => this.context.extension.openPreferences(), 'shadow-icon-button shadow-action-icon-button'));
            } else {
                actions = iconButton('view-refresh-symbolic', 'Refresh usage', () => this._provider.refresh());
            }
            root.add_child(pageTitle(`${MODULE_META[this.id].name} Usage`, actions,
                moduleIcon(this.context.extension, this.id, native ? 19 : 20,
                    native ? 'shadow-page-brand-icon' : undefined)));
            const body = new St.BoxLayout({vertical: true, style_class: native ? 'shadow-codex-content' : 'shadow-ai-body', x_expand: true});
            if (!state.data) {
                body.add_child(stateMessage('network-workgroup-symbolic',
                    state.status === 'loading' || state.refreshing ? this.id === 'commandcode' ? 'Reading Command Code usage…' : 'Reading subscription…'
                        : this.id === 'commandcode' ? 'Command Code · Unavailable' : 'Connect your subscription',
                    state.error ?? 'Waiting for your provider to report usage.',
                    textButton('Configure source', () => {
                        this.context.extension.openPreferences();
                    })));
            } else if (this.id === 'commandcode' && state.data.source === 'commandcode-api') {
                this._lastCommandCodeRemaining = commandCodeView(this.context, body, state, this._lastCommandCodeRemaining);
            } else {
                const data = state.data;
                if (this.id === 'commandcode') {
                    body.add_child(new St.Label({text: 'Live account consumption: Unavailable', style_class: 'shadow-muted'}));
                    body.add_child(new St.Label({text: 'Configured usage JSON · not an automatic account feed',
                        style_class: 'shadow-muted'}));
                }
                if (data.plan || data.account)
                    body.add_child(new St.Label({text: [data.plan, data.account].filter(Boolean).join(' · '),
                        style_class: 'shadow-muted'}));
                if (state.status === 'stale') {
                    const warning = new St.Label({text: state.error ?? 'Source is older than five minutes. Refresh your provider.',
                        style_class: 'shadow-muted'});
                    warning.clutter_text.set_line_wrap(true);
                    body.add_child(warning);
                }
                for (const window of data.windows) {
                    const card = new St.BoxLayout({vertical: true, style_class: 'shadow-card shadow-ai-card'});
                    card.add_child(new St.Label({text: window.label, style_class: 'shadow-card-title'}));
                    card.add_child(new St.Label({text: `${Math.round(100 - window.usedPercent)}% remaining`,
                        style_class: 'shadow-ai-value', style: `color: ${resolveAccent(this.context.settings)};`}));
                    const color = this.id === 'commandcode' && window.usedPercent >= 90 ? '#f38ba8'
                        : this.id === 'commandcode' && window.usedPercent >= 75 ? '#f9e2af' : resolveAccent(this.context.settings);
                    const bar = new ProgressMeter(100 - window.usedPercent, color, 'remaining',
                        this.id === 'commandcode' && animationsEnabled(this.context.settings));
                    card.add_child(bar.actor);
                    if (window.resetsAt)
                        card.add_child(new St.Label({text: formatCountdown(window.resetsAt / 1000), style_class: 'shadow-muted'}));
                    body.add_child(card);
                }
                for (const balance of data.balances) {
                    const card = new St.BoxLayout({vertical: true, style_class: 'shadow-card shadow-ai-card'});
                    card.add_child(new St.Label({text: 'API balance', style_class: 'shadow-card-title'}));
                    card.add_child(new St.Label({text: `${balance.amount.toFixed(2)} ${balance.currency}`,
                        style_class: 'shadow-ai-value', style: `color: ${resolveAccent(this.context.settings)};`}));
                    body.add_child(card);
                }
                if (data.tokens !== null)
                    body.add_child(new St.Label({text: `${new Intl.NumberFormat('en-US').format(data.tokens)} tokens reported`,
                        style_class: 'shadow-metric-value'}));
                body.add_child(new St.Label({text: `Source updated ${formatRelativeAge(data.updatedAt)}`,
                    style_class: 'shadow-muted'}));
            }
            if (this.id === 'commandcode' && !native) {
                const reference = new St.BoxLayout({vertical: true, style_class: 'shadow-card shadow-ai-card'});
                for (const [key, style] of [['title', 'shadow-card-title'], ['price', 'shadow-muted'],
                    ['limits', 'shadow-metric-value'], ['note', 'shadow-muted'], ['checked', 'shadow-muted']]) {
                    const label = new St.Label({text: GOAT_REFERENCE[key], style_class: style});
                    label.clutter_text.set_line_wrap(true);
                    reference.add_child(label);
                }
                body.add_child(reference);
                reference.add_child(textButton('View documented plan limits', () => {
                    Gio.AppInfo.launch_default_for_uri_async(GOAT_REFERENCE.source, null, null, (_source, result) => {
                        try { Gio.AppInfo.launch_default_for_uri_finish(result); }
                        catch { this.context.notify('Could not open plan documentation', 'Check your default browser.'); }
                    });
                }));
                const hint = new St.Label({text: 'Opens Studio Usage in your browser. In the CLI, run cmd (Linux) or cmdc (Windows), then /usage. Desktop: Settings → Usage.', style_class: 'shadow-muted'});
                hint.clutter_text.set_line_wrap(true);
                body.add_child(hint);
            }
            if (!native) body.add_child(textButton(this.id === 'commandcode' ? 'Open CommandCode Usage' : 'Open provider dashboard', () => {
                const url = this.id === 'commandcode' ? COMMANDCODE_USAGE_URL : MODULE_META[this.id].url;
                Gio.AppInfo.launch_default_for_uri_async(url, null, null, (_source, result) => {
                    try { Gio.AppInfo.launch_default_for_uri_finish(result); }
                    catch { this.context.notify('Could not open dashboard', 'Check your default browser.'); }
                });
            }));
            this._body = body;
            this._scroll = scrollContainer(body, native ? 'shadow-codex-scroll' : 'shadow-list-scroll');
            root.add_child(this._scroll);
        });
        this.fit();
    }

    _openCommandCodeUsage() {
        Gio.AppInfo.launch_default_for_uri_async(COMMANDCODE_USAGE_URL, null, null, (_source, result) => {
            try { Gio.AppInfo.launch_default_for_uri_finish(result); }
            catch { this.context.notify('Could not open dashboard', 'Check your default browser.'); }
        });
    }
}

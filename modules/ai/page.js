import Gio from 'gi://Gio';
import St from 'gi://St';
import {BasePage} from '../basePage.js';
import {MODULE_META} from '../../lib/constants.js';
import {formatCountdown, formatRelativeAge} from '../../lib/format.js';
import {fitScrollToContent, iconButton, moduleIcon, pageTitle, ProgressMeter, resolveAccent,
    scrollContainer, stateMessage, textButton} from '../../ui/components.js';

export class AIPage extends BasePage {
    constructor(context, id) {
        super(context, id);
        this._provider = context.aiProviders.get(id);
        this.track(this._provider.subscribe(state => this._render(state)));
    }

    activate() { this._provider.refresh(); }
    onPopupOpened() { this._provider.refresh(); }
    fit() { fitScrollToContent(this._scroll, this._body, this.context, this.actor); }

    _render(state) {
        const signature = JSON.stringify(state);
        if (signature === this._lastSignature) return;
        this._lastSignature = signature;
        this.replaceContent(root => {
            root.add_child(pageTitle(`${MODULE_META[this.id].name} Usage`,
                iconButton('view-refresh-symbolic', 'Refresh usage', () => this._provider.refresh()),
                moduleIcon(this.context.extension, this.id, 20)));
            const body = new St.BoxLayout({vertical: true, style_class: 'shadow-ai-body'});
            if (!state.data) {
                body.add_child(stateMessage('network-workgroup-symbolic',
                    state.status === 'loading' ? 'Reading subscription…' : 'Connect your subscription',
                    state.error ?? 'Waiting for your provider to report usage.',
                    textButton('Configure source', () => {
                        this.context.extension.openPreferences();
                    })));
            } else {
                const data = state.data;
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
                    const bar = new ProgressMeter(100 - window.usedPercent, resolveAccent(this.context.settings), 'remaining');
                    card.add_child(bar.actor);
                    if (window.resetsAt)
                        card.add_child(new St.Label({text: formatCountdown(window.resetsAt), style_class: 'shadow-muted'}));
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
            body.add_child(textButton('Open provider dashboard', () => {
                Gio.AppInfo.launch_default_for_uri_async(MODULE_META[this.id].url, null, null, (_source, result) => {
                    try { Gio.AppInfo.launch_default_for_uri_finish(result); }
                    catch { this.context.notify('Could not open dashboard', 'Check your default browser.'); }
                });
            }));
            this._body = body;
            this._scroll = scrollContainer(body);
            root.add_child(this._scroll);
        });
        this.fit();
    }
}

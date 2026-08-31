import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

function labelsIn(actor, labels = []) {
    if (actor instanceof St.Label)
        labels.push(actor.text);
    for (const child of actor.get_children?.() ?? [])
        labelsIn(child, labels);
    return labels;
}

function allocation(actor) {
    return {
        width: actor?.width ?? 0,
        height: actor?.height ?? 0,
        visible: Boolean(actor?.visible),
    };
}

function scrollState(page) {
    const scroll = page?._scroll;
    if (!scroll)
        return null;
    const naturalHeight = scroll._shadowNaturalHeight ?? null;
    return {
        viewportHeight: scroll.height,
        measuredNaturalHeight: naturalHeight,
        needsScroll: Number.isFinite(naturalHeight) && naturalHeight > scroll.height + 1,
    };
}

export default class UiSmokeExtension extends Extension {
    enable() {
        this._attempts = 0;
        this._source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._attempts++;
            const indicator = Main.panel.statusArea['shadow-panel@shadowokx'];
            const services = indicator?._extension?.getRuntimeServices?.();
            const codexReady = Boolean(services?.codexProvider?.getState()?.lastSuccessfulRefresh);
            const weatherReady = Boolean(services?.weatherProvider?.getState()?.lastSuccessfulRefresh);
            if (!indicator || (!codexReady || !weatherReady) && this._attempts < 40)
                return GLib.SOURCE_CONTINUE;
            this._source = 0;
            this._exercise(indicator, services);
            return GLib.SOURCE_REMOVE;
        });
    }

    _exercise(indicator, services) {
        const reportPath = GLib.getenv('SHADOW_UI_REPORT');
        const report = {
            codexProviderStatus: services?.codexProvider?.getState()?.status ?? null,
            weatherProviderStatus: services?.weatherProvider?.getState()?.status ?? null,
            tabSwitches: [],
            refreshStateExercised: false,
        };
        indicator.menu.open();
        for (const id of ['codex', 'weather', 'codex', 'weather']) {
            indicator._select(id);
            const page = indicator._pages.get(id);
            const labels = labelsIn(page.actor);
            report.tabSwitches.push({
                id,
                page: allocation(page.actor),
                stack: allocation(indicator._pageStack),
                scroll: scrollState(page),
                childCount: page.actor.get_children().length,
                hasExpectedContent: id === 'codex'
                    ? labels.includes('Weekly capacity')
                    : labels.includes('Next hours') &&
                        labels.includes(services?.weatherProvider?.getState()?.current?.condition?.label),
            });
        }
        for (const [id, provider] of [
            ['codex', services?.codexProvider],
            ['weather', services?.weatherProvider],
        ]) {
            const page = indicator._pages.get(id);
            const actions = page?._actions?.({...provider?.getState(), status: 'refreshing'});
            page?._stopRefreshAnimation?.();
            actions?.destroy();
        }
        report.refreshStateExercised = true;
        indicator.menu.close();
        indicator.menu.open();
        report.reopened = indicator.menu.isOpen;
        indicator.menu.close();
        GLib.file_set_contents(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }

    disable() {
        if (this._source)
            GLib.Source.remove(this._source);
        this._source = 0;
    }
}

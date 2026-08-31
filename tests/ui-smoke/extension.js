import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

Gio._promisify(Shell.Screenshot.prototype, 'screenshot');

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

function settle(milliseconds = 60) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

function scrollState(page) {
    const scroll = page?._scroll;
    if (!scroll)
        return null;
    const naturalHeight = scroll._shadowNaturalHeight ?? null;
    const adjustment = scroll.vadjustment ?? scroll.vscroll?.adjustment;
    return {
        viewportHeight: scroll.height,
        measuredNaturalHeight: naturalHeight,
        needsScroll: Number.isFinite(naturalHeight) && naturalHeight > scroll.height + 1,
        value: adjustment?.value ?? 0,
        policy: scroll.vscrollbar_policy,
    };
}

function findStyle(actor, styleClass) {
    if (actor?.has_style_class_name?.(styleClass))
        return actor;
    for (const child of actor?.get_children?.() ?? []) {
        const found = findStyle(child, styleClass);
        if (found)
            return found;
    }
    return null;
}

async function captureScreenshot(path) {
    if (!path)
        return;
    const file = Gio.File.new_for_path(path);
    const stream = file.replace(
        null,
        false,
        Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION,
        null
    );
    try {
        await new Shell.Screenshot().screenshot(false, stream);
    } finally {
        stream.close(null);
    }
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
            this._exercise(indicator, services).catch(error => logError(error));
            return GLib.SOURCE_REMOVE;
        });
    }

    async _exercise(indicator, services) {
        const reportPath = GLib.getenv('SHADOW_UI_REPORT');
        const report = {
            codexProviderStatus: services?.codexProvider?.getState()?.status ?? null,
            weatherProviderStatus: services?.weatherProvider?.getState()?.status ?? null,
            tabSwitches: [],
            refreshStateExercised: false,
            openCloseCycles: 0,
        };
        indicator.menu.open();
        for (const id of ['codex', 'weather', 'codex', 'weather']) {
            indicator._select(id);
            await settle();
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
            if (id === 'codex') {
                report.graph = allocation(findStyle(page.actor, 'shadow-token-sparkline'));
            } else {
                const hourlyAdjustment = page?._hourlyScroll?.hadjustment ??
                    page?._hourlyScroll?.hscroll?.adjustment;
                report.hourly = {
                    viewportWidth: page?._hourlyScroll?.width ?? 0,
                    contentWidth: hourlyAdjustment?.upper ?? 0,
                    pageWidth: hourlyAdjustment?.page_size ?? 0,
                    verticalPolicy: page?._hourlyScroll?.vscrollbar_policy ?? null,
                };
            }
        }
        const codexPage = indicator._pages.get('codex');
        const codexAdjustment = codexPage?._scroll?.vadjustment ??
            codexPage?._scroll?.vscroll?.adjustment;
        if (codexAdjustment?.upper > codexAdjustment?.page_size) {
            codexAdjustment.set_value(Math.min(80,
                codexAdjustment.upper - codexAdjustment.page_size));
            indicator._select('weather');
            await settle();
            indicator._select('codex');
            await settle();
            const currentAdjustment = codexPage?._scroll?.vadjustment ??
                codexPage?._scroll?.vscroll?.adjustment;
            report.scrollResetValue = currentAdjustment?.value ?? null;
        } else {
            report.scrollResetValue = 0;
        }
        report.rootStyle = indicator._root.style_class;
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
        for (let cycle = 0; cycle < 20; cycle++) {
            indicator.menu.open();
            if (indicator.menu.isOpen)
                report.openCloseCycles++;
            indicator.menu.close();
        }
        indicator.menu.open();
        const capturePage = GLib.getenv('SHADOW_UI_PAGE');
        if (capturePage === 'codex' || capturePage === 'weather') {
            indicator._select(capturePage);
            await settle(120);
        }
        report.reopened = indicator.menu.isOpen;
        await captureScreenshot(GLib.getenv('SHADOW_UI_SCREENSHOT'));
        indicator.menu.close();
        if (GLib.getenv('SHADOW_UI_LIFECYCLE') === 'true') {
            Main.extensionManager.disableExtension('shadow-panel@shadowokx');
            await settle(250);
            report.disabledRemoved = !Main.panel.statusArea['shadow-panel@shadowokx'];
            Main.extensionManager.enableExtension('shadow-panel@shadowokx');
            for (let attempt = 0; attempt < 40; attempt++) {
                const candidate = Main.panel.statusArea['shadow-panel@shadowokx'];
                const timerCount = candidate?._extension
                    ?.getRuntimeServices?.().scheduler?._sources?.size;
                if (candidate && timerCount === 2)
                    break;
                await settle(100);
            }
            const replacement = Main.panel.statusArea['shadow-panel@shadowokx'];
            report.reenabled = Boolean(replacement);
            report.timerCountAfterReenable =
                replacement?._extension?.getRuntimeServices?.().scheduler?._sources?.size ?? null;
        }
        GLib.file_set_contents(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }

    disable() {
        if (this._source)
            GLib.Source.remove(this._source);
        this._source = 0;
    }
}

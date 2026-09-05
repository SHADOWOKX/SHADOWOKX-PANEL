import Clutter from 'gi://Clutter';
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

function findStyles(actor, styleClass, matches = []) {
    if (actor?.has_style_class_name?.(styleClass))
        matches.push(actor);
    for (const child of actor?.get_children?.() ?? [])
        findStyles(child, styleClass, matches);
    return matches;
}

function progressAllocation(track) {
    if (!track)
        return null;
    const box = new Clutter.ActorBox();
    box.x1 = 0;
    box.y1 = 0;
    box.x2 = track.width;
    box.y2 = track.height;
    const content = track.get_theme_node().get_content_box(box);
    const fill = findStyle(track, 'shadow-progress-fill');
    return {
        trackWidth: track.width,
        usableWidth: Math.round(content.x2) - Math.round(content.x1),
        fillX: fill?.x ?? null,
        fillWidth: fill?.width ?? null,
    };
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
            const weatherNeeded = Boolean(services?.weatherProvider);
            const weatherReady = !weatherNeeded ||
                Boolean(services.weatherProvider.getState()?.lastSuccessfulRefresh);
            if (!indicator || (!codexReady || !weatherReady) && this._attempts < 40)
                return GLib.SOURCE_CONTINUE;
            this._source = 0;
            this._exercise(indicator, services).catch(error => logError(error));
            return GLib.SOURCE_REMOVE;
        });
    }

    async _exercise(indicator, services) {
        // Auto-theme discovery can queue one startup rebuild after providers
        // become ready. Exercise the stable status-area actor, never the
        // instance Shell just retired during that initialization window.
        await settle(220);
        const stableIndicator = Main.panel.statusArea['shadow-panel@shadowokx'];
        if (stableIndicator && stableIndicator !== indicator) {
            indicator = stableIndicator;
            services = indicator._extension.getRuntimeServices();
        }
        const reportPath = GLib.getenv('SHADOW_UI_REPORT');
        const codexState = services?.codexProvider?.getState();
        if (codexState?.tokenUsage && codexState.tokenUsage.dailyBuckets.length < 2) {
            const dailyBuckets = Array.from({length: 7}, (_value, index) => {
                const date = new Date(Date.now() - (6 - index) * 86_400_000);
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return {date: `${year}-${month}-${day}`, tokens: [42000000, 26000000, 31000000, 18000000, 12000000, 17000000, 25000000][index]};
            });
            services.codexProvider._setState({
                ...codexState,
                tokenUsage: {
                    ...codexState.tokenUsage,
                    dailyBuckets,
                    todayTokens: dailyBuckets.at(-1).tokens,
                    peakDailyTokens: dailyBuckets[0].tokens,
                    peakDate: dailyBuckets[0].date,
                    sevenDayTokens: dailyBuckets.reduce((sum, bucket) => sum + bucket.tokens, 0),
                },
            });
        }
        const displayLocation = GLib.getenv('SHADOW_TEST_DISPLAY_LOCATION');
        if (displayLocation && services?.weatherProvider) {
            const weatherState = services.weatherProvider.getState();
            services.weatherProvider._setState({...weatherState, location: displayLocation});
        }
        const report = {
            codexProviderStatus: services?.codexProvider?.getState()?.status ?? null,
            weatherProviderStatus: services?.weatherProvider?.getState()?.status ?? null,
            tabSwitches: [],
            refreshStateExercised: false,
            refreshTreesPreserved: true,
            openCloseCycles: 0,
            moduleIds: [...indicator._pages.keys()],
            tabWidths: [],
            weatherTopBarVisible: indicator._weatherSummary.item.visible,
            usageStateSetting: indicator._settings.get_boolean('show-codex-usage-state'),
            usageStateKey: indicator._lastUsageState,
            usageStateVisible: indicator._codexPaceIcon.visible,
            expectedTimerCount: services?.weatherProvider ? 2 : 1,
        };

        const originalMascotSetting = indicator._settings.get_boolean('animated-mascot');
        const originalAnimationsSetting = indicator._settings.get_boolean('animations');
        services.codexActivityMonitor.stop();
        indicator._settings.set_boolean('animated-mascot', true);
        indicator._settings.set_boolean('animations', true);
        indicator._mascot.setState('idle');
        indicator._mascot._clearPostCloseTimer();
        indicator._mascot._reconcileSemanticState();
        await settle(30);
        report.mascotSleepingIdle = indicator._mascot._state === 'sleeping' &&
            indicator._mascot._currentFrame === 'robot-sleep.svg' &&
            indicator._mascot._activeId === 0;
        report.mascotSleepDelayMs = indicator._mascot._sleepDelayMs;
        report.mascotPostCloseDelayMs = indicator._mascot._postCloseDelayMs;
        const originalPostCloseDelay = indicator._mascot._postCloseDelayMs;
        const originalMascotRefresh = services.codexProvider.refresh;
        services.codexProvider.refresh = () => Promise.resolve(
            services.codexProvider.getState()
        );
        indicator._mascot._postCloseDelayMs = 80;
        indicator.menu.open();
        await settle(40);
        report.mascotWakingTransition = indicator._mascot._state === 'waking';
        await settle(340);
        report.mascotPopupAwake = indicator._mascot._state === 'awake' &&
            indicator._mascot._currentFrame === 'robot-awake.svg';
        indicator.menu.close();
        await settle(30);
        report.mascotAwakeDuringCloseDelay = indicator._mascot._state === 'awake';
        await settle(80);
        report.mascotGoingToSleepTransition =
            indicator._mascot._state === 'going-to-sleep';
        await settle(340);
        report.mascotSleepsAfterClose = indicator._mascot._state === 'sleeping' &&
            indicator._mascot._currentFrame === 'robot-sleep.svg';
        indicator._mascot._postCloseDelayMs = originalPostCloseDelay;

        const mascotLabelX = indicator._codexSummary.label.x;
        report.mascotLabelGap = indicator._codexSummary.label.x -
            (indicator._mascot.actor.x + indicator._mascot.actor.width);
        indicator._mascot.setState('active');
        report.mascotSleepingToActive = indicator._mascot._state === 'active';
        const startingMascotFrame = indicator._mascot._activeFrame;
        await settle(220);
        report.mascotActiveLoop = indicator._mascot._state === 'active' &&
            indicator._mascot._activeId !== 0 &&
            indicator._mascot._activeFrame !== startingMascotFrame;
        indicator.menu.open();
        await settle(40);
        report.mascotActivePriority = indicator._mascot._state === 'active';
        indicator._mascot.setState('idle');
        report.mascotActiveToAwake = indicator._mascot._state === 'awake';
        indicator._mascot.setState('active');
        report.mascotAwakeToActive = indicator._mascot._state === 'active';
        indicator.menu.close();
        report.mascotLabelStable = indicator._codexSummary.label.x === mascotLabelX;
        report.mascotSize = {
            width: indicator._mascot.actor.width,
            height: indicator._mascot.actor.height,
            indicatorHeight: indicator.height,
            panelHeight: Main.panel.height,
        };
        indicator._settings.set_boolean('animated-mascot', false);
        indicator._mascot.setState('idle');
        indicator._mascot._clearPostCloseTimer();
        indicator._mascot._reconcileSemanticState();
        await settle(40);
        report.mascotSettingStopsAnimation = !indicator._mascot._animationAllowed &&
            indicator._mascot._activeId === 0 &&
            indicator._mascot._state === 'sleeping' &&
            indicator._mascot._currentFrame === 'robot-sleep.svg';
        indicator.menu.open();
        await settle(20);
        const disabledPopupAwake = indicator._mascot._state === 'awake' &&
            indicator._mascot._currentFrame === 'robot-awake.svg';
        indicator._mascot.setState('active');
        const disabledActiveStatic = indicator._mascot._state === 'active' &&
            indicator._mascot._currentFrame === 'robot-active-11.svg' &&
            indicator._mascot._activeId === 0;
        indicator._mascot.setState('idle');
        indicator._mascot._postCloseDelayMs = 20;
        indicator.menu.close();
        await settle(30);
        report.mascotAnimationsDisabledSemantic = disabledPopupAwake &&
            disabledActiveStatic && indicator._mascot._state === 'sleeping';
        indicator._settings.set_boolean('animated-mascot', true);
        const interfaceSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });
        const originalSystemAnimations = interfaceSettings.get_boolean('enable-animations');
        interfaceSettings.set_boolean('enable-animations', false);
        await settle(80);
        indicator.menu.open();
        await settle(20);
        const reducedPopupAwake = indicator._mascot._state === 'awake' &&
            indicator._mascot._currentFrame === 'robot-awake.svg';
        indicator._mascot.setState('active');
        const reducedActiveStatic = indicator._mascot._state === 'active' &&
            indicator._mascot._currentFrame === 'robot-active-11.svg' &&
            indicator._mascot._activeId === 0;
        indicator._mascot.setState('idle');
        indicator.menu.close();
        await settle(30);
        report.mascotReducedMotion = !indicator._mascot._animationAllowed &&
            indicator._mascot._activeId === 0 && reducedPopupAwake &&
            reducedActiveStatic && indicator._mascot._state === 'sleeping' &&
            indicator._mascot._currentFrame === 'robot-sleep.svg';
        indicator._mascot._postCloseDelayMs = originalPostCloseDelay;
        interfaceSettings.set_boolean('enable-animations', originalSystemAnimations);
        indicator._settings.set_boolean('animated-mascot', originalMascotSetting);
        indicator._settings.set_boolean('animations', originalAnimationsSetting);
        services.codexActivityMonitor.stop();
        services.codexActivityMonitor.start();
        await settle(80);
        services.codexProvider.refresh = originalMascotRefresh;

        indicator.menu.open();
        await settle();
        report.tabWidths = [...(indicator._tabs?._buttons?.values?.() ?? [])]
            .map(({button}) => button.width);
        const sequence = report.moduleIds.includes('weather')
            ? ['codex', 'weather', 'codex', 'weather']
            : ['codex', 'codex', 'codex', 'codex'];
        for (const id of sequence) {
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
                    ? labels.includes('Weekly allowance')
                    : labels.includes('Next hours') &&
                        labels.includes(services?.weatherProvider?.getState()?.current?.condition?.label),
            });
            if (id === 'codex') {
                report.graph = allocation(findStyle(page.actor, 'shadow-token-sparkline'));
                await captureScreenshot(GLib.getenv('SHADOW_UI_GRAPH_SCREENSHOT'));
                const dayLabels = findStyle(page.actor, 'shadow-spark-days');
                report.graphDayLabels = {
                    ...allocation(dayLabels),
                    count: dayLabels?.get_children?.().length ?? 0,
                    expectedCount: services?.codexProvider?.getState()
                        ?.tokenUsage?.dailyBuckets?.length ?? 0,
                    positions: dayLabels?.get_children?.().map(label => ({
                        x: label.x,
                        width: label.width,
                    })) ?? [],
                    texts: dayLabels?.get_children?.().map(label => label.text) ?? [],
                };
                const graphTargets = findStyles(page.actor, 'shadow-token-point-target');
                report.graphPointTooltips = {
                    count: graphTargets.length,
                    expectedCount: services?.codexProvider?.getState()
                        ?.tokenUsage?.dailyBuckets?.length ?? 0,
                    interactive: graphTargets.every(target => target.reactive && target.track_hover),
                };
                const tokenRow = findStyle(page.actor, 'shadow-token-row');
                report.todayMetric = {
                    labels: labelsIn(tokenRow),
                    accessibleName: tokenRow?.get_first_child?.()?.accessible_name ?? null,
                    canonicalTokens: services?.codexProvider?.getState()?.tokenUsage
                        ?.dailyBuckets?.find(bucket => {
                            const now = new Date();
                            const key = `${now.getFullYear()}-` +
                                `${String(now.getMonth() + 1).padStart(2, '0')}-` +
                                String(now.getDate()).padStart(2, '0');
                            return bucket.date === key;
                        })?.tokens ?? null,
                };
                if (!report.progressGeometry) {
                    const provider = services.codexProvider;
                    const originalState = provider.getState();
                    report.progressGeometry = [];
                    for (const remainingPercent of [98, 100]) {
                        page._lastWeeklyPercent = null;
                        provider._setState({
                            ...originalState,
                            weekly: {
                                ...originalState.weekly,
                                remainingPercent,
                                usedPercent: 100 - remainingPercent,
                            },
                        });
                        await settle();
                        report.progressGeometry.push({
                            remainingPercent,
                            ...progressAllocation(findStyle(page.actor, 'shadow-progress-track')),
                        });
                    }
                    page._lastWeeklyPercent = null;
                    provider._setState(originalState);
                    await settle();
                }
                report.codexFooter = allocation(findStyle(page.actor, 'shadow-codex-footer'));
                report.historyBadgeIcon = allocation(findStyle(page.actor, 'shadow-status-icon'));
            } else {
                const hourlyAdjustment = page?._hourlyScroll?.hadjustment ??
                    page?._hourlyScroll?.hscroll?.adjustment;
                report.hourly = {
                    viewportWidth: page?._hourlyScroll?.width ?? 0,
                    contentWidth: hourlyAdjustment?.upper ?? 0,
                    pageWidth: hourlyAdjustment?.page_size ?? 0,
                    verticalPolicy: page?._hourlyScroll?.vscrollbar_policy ?? null,
                };
                report.uvRow = allocation(findStyle(page.actor, 'shadow-weather-metric-wide'));
                const location = findStyle(page.actor, 'shadow-weather-location');
                report.weatherLocation = {
                    ...allocation(location),
                    parentWidth: location?.get_parent?.()?.width ?? 0,
                    textLength: [...(location?.text ?? '')].length,
                    ellipsize: location?.clutter_text?.ellipsize ?? null,
                };
            }
        }
        const codexPage = indicator._pages.get('codex');
        const codexAdjustment = codexPage?._scroll?.vadjustment ??
            codexPage?._scroll?.vscroll?.adjustment;
        if (codexAdjustment?.upper > codexAdjustment?.page_size) {
            codexAdjustment.set_value(Math.min(80,
                codexAdjustment.upper - codexAdjustment.page_size));
            indicator._select(report.moduleIds.includes('weather') ? 'weather' : 'codex');
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
            if (!page || !provider)
                continue;
            indicator._select(id);
            await settle();
            const originalState = provider.getState();
            const originalTree = page.actor.get_first_child();
            provider._setState({...originalState, status: 'refreshing'});
            await settle();
            report.refreshTreesPreserved &&=
                page.actor.get_first_child() === originalTree;
            page?._stopRefreshAnimation?.();
            provider._setState(originalState);
            await settle();
        }
        report.refreshStateExercised = true;
        const originalUsageSetting = indicator._settings.get_boolean('show-codex-usage-state');
        indicator._settings.set_boolean('show-codex-usage-state', false);
        await settle();
        report.usageSettingUpdatedLive =
            Main.panel.statusArea['shadow-panel@shadowokx'] === indicator &&
            !indicator._codexPaceIcon.visible;
        indicator._settings.set_boolean('show-codex-usage-state', originalUsageSetting);
        await settle();
        indicator.menu.close();
        // Auto-theme initialization can legitimately queue one deferred
        // dashboard rebuild. Let it finish before the lifecycle assertions so
        // the smoke helper never keeps inspecting an actor that Shell disposed.
        await settle(180);
        const currentIndicator = Main.panel.statusArea['shadow-panel@shadowokx'];
        if (currentIndicator && currentIndicator !== indicator) {
            indicator = currentIndicator;
            services = indicator._extension.getRuntimeServices();
        }

        // Exercise the popup-to-provider policy only after any intentionally
        // deferred startup rebuild has settled. Stub refresh here so the smoke
        // helper verifies signals/timers without spawning extra Codex helpers.
        const codexProvider = services.codexProvider;
        const originalRefresh = codexProvider.refresh.bind(codexProvider);
        let immediateRefreshes = 0;
        codexProvider.refresh = () => {
            immediateRefreshes++;
            return Promise.resolve(codexProvider.getState());
        };
        if (report.moduleIds.includes('weather'))
            indicator._select('weather');
        indicator.menu.open();
        await settle();
        report.popupRefreshImmediate = immediateRefreshes === 1;
        report.codexVisibleAfterPopupOpen = codexProvider._viewVisible;
        indicator._select('codex');
        await settle();
        report.codexTabRefreshImmediate = report.moduleIds.includes('weather')
            ? immediateRefreshes === 2
            : immediateRefreshes === 1;
        report.codexVisibleAfterTab = codexProvider._viewVisible;
        indicator._select('codex');
        await settle();
        report.sameTabRefreshes = immediateRefreshes;
        report.timerCountWhileCodexVisible = services.scheduler._sources.size;
        indicator.menu.close();
        await settle();
        report.codexBackgroundAfterClose = !codexProvider._viewVisible;
        report.timerCountAfterFocusedClose = services.scheduler._sources.size;
        codexProvider.refresh = originalRefresh;

        const originalCodexState = codexProvider.getState();
        if (originalCodexState.weekly) {
            const remaining = originalCodexState.weekly.remainingPercent === 0
                ? 1
                : originalCodexState.weekly.remainingPercent - 1;
            codexProvider._setState({
                ...originalCodexState,
                weekly: {
                    ...originalCodexState.weekly,
                    remainingPercent: remaining,
                    usedPercent: 100 - remaining,
                },
            });
            await settle();
            report.topBarAutomaticUpdate = indicator._codexSummary.label.text
                .includes(`${remaining}%`);
            codexProvider._setState(originalCodexState);
            await settle();
        } else {
            report.topBarAutomaticUpdate = true;
        }

        for (let cycle = 0; cycle < 20; cycle++) {
            indicator.menu.open();
            if (indicator.menu.isOpen)
                report.openCloseCycles++;
            indicator.menu.close();
        }
        const hiddenChildren = new Map([...indicator._pages]
            .map(([id, page]) => [id, page.actor.get_first_child()]));
        services.codexProvider._setState({...services.codexProvider.getState()});
        if (services.weatherProvider)
            services.weatherProvider._setState({...services.weatherProvider.getState()});
        await settle();
        report.hiddenPageTreesPreserved = [...indicator._pages]
            .every(([id, page]) => page.actor.get_first_child() === hiddenChildren.get(id));
        report.unchangedCodexStateIgnored = !indicator._pages.get('codex')._stateDirty;
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
            // Allow the intentionally short page/tab exit transitions to
            // settle before simulating an extension-manager teardown.
            await settle(220);
            Main.extensionManager.disableExtension('shadow-panel@shadowokx');
            await settle(250);
            report.disabledRemoved = !Main.panel.statusArea['shadow-panel@shadowokx'];
            Main.extensionManager.enableExtension('shadow-panel@shadowokx');
            for (let attempt = 0; attempt < 40; attempt++) {
                const candidate = Main.panel.statusArea['shadow-panel@shadowokx'];
                const timerCount = candidate?._extension
                    ?.getRuntimeServices?.().scheduler?._sources?.size;
                if (candidate && timerCount === report.expectedTimerCount)
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

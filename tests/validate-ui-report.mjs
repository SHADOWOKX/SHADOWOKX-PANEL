import GLib from 'gi://GLib';
import System from 'system';

const reportPath = ARGV[0];
if (!reportPath) {
    printerr('UI report path is required');
    System.exit(1);
}

const [loaded, bytes] = GLib.file_get_contents(reportPath);
if (!loaded) {
    printerr('UI report could not be read');
    System.exit(1);
}

const report = JSON.parse(new TextDecoder().decode(bytes));
const expect = name => GLib.getenv(name) === 'true';
const expectScroll = expect('SHADOW_EXPECT_SCROLL');
const expectLifecycle = expect('SHADOW_UI_LIFECYCLE');
const expectWeatherPanel = expect('SHADOW_SHOW_WEATHER_PANEL');
const expectWeatherTopBar = expect('SHADOW_SHOW_WEATHER_TOP_BAR');
const pageWidths = new Set(report.tabSwitches.map(item => item.page.width));
const scrolling = report.tabSwitches.some(item => item.scroll?.needsScroll);

const badPolicy = report.tabSwitches.some(item => item.scroll && (
    !item.scroll.pageMapped || item.scroll.fitPending ||
    !Number.isFinite(item.scroll.measuredNaturalHeight) ||
    (item.scroll.needsScroll ? item.scroll.policy === 2 : item.scroll.policy !== 2)));
const badLifecycle = expectLifecycle && (!report.disabledRemoved || !report.reenabled ||
    report.timerCountAfterReenable !== report.expectedTimerCount);
const badModules = report.moduleIds.includes('weather') !== expectWeatherPanel ||
    report.tabWidths.length !== report.moduleIds.length ||
    report.tabWidths.some(width => width <= 0 || Math.abs(width - report.tabWidths[0]) > 1);
const badWeatherTopBar = report.weatherTopBarVisible !== expectWeatherTopBar;
const badUsageState = report.usageStateVisible !== Boolean(report.usageStateKey) ||
    (!report.usageStateSetting && report.usageStateVisible);
const badMascot = !report.mascotSleepingIdle || !report.mascotPopupStatic ||
    !report.mascotPopupAwake ||
    !report.mascotAwakeDuringCloseDelay || !report.mascotSleepsAfterClose ||
    !report.mascotIdleStatic || !report.mascotSleepingToActive ||
    !report.mascotAwakeToActive || !report.mascotActiveToAwake ||
    !report.mascotActiveLoop || !report.mascotActivePriority ||
    !report.mascotSettingStopsAnimation || !report.mascotAnimationsDisabledSemantic ||
    !report.mascotReducedMotion ||
    !report.mascotLabelStable || report.mascotLabelGap < 6 || report.mascotLabelGap > 8 ||
    report.mascotPostCloseDelayMs < 2000 || report.mascotPostCloseDelayMs > 4000 ||
    report.mascotSleepDelayMs !== 0 ||
    report.mascotSize?.width !== 20 || report.mascotSize?.height !== 20 ||
    report.mascotSize?.indicatorHeight > report.mascotSize?.panelHeight;
const badHourly = expectWeatherPanel && (!report.hourly ||
    report.hourly.verticalPolicy !== 2 ||
    report.hourly.contentWidth <= report.hourly.pageWidth);
const badUv = expectWeatherPanel && (!report.uvRow ||
    report.uvRow.width <= 300 || report.uvRow.height <= 0);
const badLocation = expectWeatherPanel && (!report.weatherLocation ||
    report.weatherLocation.width <= 0 ||
    report.weatherLocation.width > report.weatherLocation.parentWidth ||
    report.weatherLocation.ellipsize === 0);
const heatmap = report.heatmap;
const badHeatmap = !heatmap?.daily?.visible || !heatmap?.weekly?.visible ||
    heatmap.daily.width < 250 || heatmap.weekly.width < 250 ||
    heatmap.daily.height !== 54 || heatmap.weekly.height !== 54 ||
    heatmap.monthCount !== 12 || !heatmap.interactive || !heatmap.treePreserved ||
    !heatmap.dailyLabels.includes('Daily peak') || !heatmap.weeklyLabels.includes('Weekly peak');
const badTodayMetric = !report.todayMetric?.labels?.some(label => label.startsWith('Today')) ||
    (Number.isSafeInteger(report.todayMetric.canonicalTokens)
        ? !report.todayMetric.accessibleName?.includes(
            new Intl.NumberFormat('en-US').format(report.todayMetric.canonicalTokens))
        : !report.todayMetric.labels.includes('Pending') ||
          !report.todayMetric.accessibleName?.includes('not reported'));
const badProgress = report.progressGeometry?.length !== 2 ||
    report.progressGeometry.some(item => !Number.isFinite(item.usableWidth) ||
        item.usableWidth <= 0 || !Number.isFinite(item.fillWidth)) ||
    Math.abs(report.progressGeometry[0].fillWidth /
        report.progressGeometry[0].usableWidth - 0.98) > 0.005 ||
    report.progressGeometry[1].fillWidth !== report.progressGeometry[1].usableWidth;
const badCostSummary = expect('SHADOW_UI_COST_SAMPLE') &&
    (!report.costSummary?.visible || report.costSummary.width <= 0);
const badCodexPolish = badCostSummary || !report.codexFooter || report.codexFooter.width <= 300 ||
    badHeatmap ||
    badTodayMetric || badProgress;
const badPage = report.tabSwitches.length !== 4 || report.tabSwitches.some(item =>
    !item.hasExpectedContent || item.page.width <= 0 || item.page.height <= 0 ||
    item.stack.height <= 0 || item.childCount < 2);
const badCodexRefreshLifecycle = !report.popupRefreshDeferred ||
    !report.popupRefreshAfterPaint ||
    report.codexVisibleAfterPopupOpen !== !expectWeatherPanel ||
    !report.codexTabRefreshDeferred || !report.codexTabRefreshAfterPaint ||
    !report.codexVisibleAfterTab || report.sameTabRefreshes !== 1 ||
    !report.quickCloseCancelsRefresh || !report.accountRefreshTreePreserved ||
    !report.accountCheckingCaption || !report.accountRefreshCaptionRestored ||
    !report.codexBackgroundAfterClose || !report.topBarAutomaticUpdate ||
    report.timerCountWhileCodexVisible !== report.expectedTimerCount + 1 ||
    report.timerCountAfterFocusedClose !== report.expectedTimerCount;

if (!report.octopusScenes || !report.octopusFixedSize || !report.octopusStopsWhenIdle || !report.mascotIdleDespiteVariety || !report.mascotApplicationStatic || report.aiPages?.length !== 6 || report.aiPages.some(page => !page.ready || page.width <= 0 || page.height <= 0) ||
    !report.aiAllowanceRendered || !report.focusKeepsSelectedAllowance || !report.selectedProviderSummary || !report.reopened || !report.usageSettingUpdatedLive ||
    !report.unchangedCodexStateIgnored ||
    !report.hiddenPageTreesPreserved || !report.refreshTreesPreserved ||
    report.openCloseCycles !== 20 || report.scrollResetValue !== 0 ||
    !report.refreshStateExercised || pageWidths.size !== 1 ||
    scrolling !== expectScroll || badPolicy || badLifecycle || badModules ||
    badWeatherTopBar || badUsageState || badMascot || badHourly || badUv || badLocation ||
    badCodexPolish || (Number(GLib.getenv('SHADOW_UI_HEIGHT')) >= 768 &&
        Number(GLib.getenv('SHADOW_TEXT_SCALE')) <= 1 && !report.popupFitsScreen) ||
    report.graph.width <= 0 || report.graph.height < 45 || badPage ||
    badCodexRefreshLifecycle) {
    throw new Error(JSON.stringify(report));
}

print(JSON.stringify(report));

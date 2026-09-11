# Shadowokx Panel for Windows 2.0

A compact dashboard matching the Linux panel, with less background work and corrected tray placement.

## Dashboard

- Rounded neutral cards, segmented Codex/Weather navigation, quieter typography, weather icon tiles and grouped weather metrics.
- Weekly allowance uses green at 60–100% remaining, yellow at 30–59%, and red below 30%. The number and bar use the same rounded value. Star columns preserve the proportion after tab changes and DPI layout.
- Today, Yesterday and Last 30 Days show estimated API cost and local tokens directly beneath the limit bar. No price in the tray and no separate cost graph. Unknown prices remain unpriced; tooltips identify partial coverage and stale estimates. This is an API equivalent, not a subscription invoice.
- Normal content fits the popup; wheel/touch scrolling remains available only for constrained work areas or larger accessibility text.

## Responsiveness and resource use

- Reopening or switching back to fresh Codex data reuses it. Manual refresh still requests new data. One request at a time; the visible interval remains 30 seconds and the background interval is now 3 minutes (20 scheduled checks/hour instead of 60).
- Failed automatic requests back off up to 15 minutes; manual retry remains available.
- Weather waits for its configured interval instead of waking every minute. Disabled weather waits without a periodic wake-up and rejects refresh requests.
- Cost reading runs off the UI thread, only while Codex is visible, at most every two minutes. Only appended content is read on growing session files; unchanged files reuse usage-only metadata cached on disk. Conversation text is never cached.
- File/record counts, retained metadata and line buffers have explicit limits; limited scans are marked partial. Cancellation stops outstanding work on exit.
- Child-process stderr is drained through a fixed buffer. Oversized protocol lines are rejected before a full line is allocated.
- Hidden pages stop refresh animations. Hidden popup clocks stop. Existing graph and forecast data are reused when unchanged.

## Placement and reliability

- Placement uses the notification icon rectangle, including overflow placement, rather than the cursor position after a context-menu selection.
- Monitor work area and scaling are calculated in physical pixels; negative monitor coordinates, taskbars on each edge, and small work areas are clamped safely.
- Display and DPI changes queue one reposition pass. Version 4 tray activation supports mouse and keyboard activation. Native tray callbacks contain exceptions instead of letting them cross into WinUI.
- Disposed view models ignore already queued callbacks; provider disposal is idempotent and cancelled refreshes restore the prior display state.

## Validation

Core tests cover cached/uncached pricing, unknown models, fork deduplication, persistent cache reuse, incremental reading of a 3 MB fixture, 50 fresh popup opens without extra Codex requests, bounded protocol output, cancellation, adaptive scheduling, and multi-monitor placement at 100–300% scaling.

Windows CI builds the self-contained installer and portable ZIP, validates packaged resources, and runs an isolated native UI smoke mode (`--ui-smoke`) that exercises ten limit values through tab changes and twenty reopen cycles, captures both pages, and verifies hidden UI timers stop. It uses fixture data and does not start network or Codex providers.

Before promoting to a stable release, complete `RELEASE-QA.md` on a real Windows 11 machine, especially mixed-DPI displays, tray overflow, live Codex sign-in, installation over version 1, and resource use over a normal work session. Automated tests do not establish a zero-CPU or zero-memory guarantee.

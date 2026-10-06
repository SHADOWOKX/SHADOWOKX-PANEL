# Windows taskbar companion

The taskbar companion renders the selected provider's remaining allowance beside the
Clawd/octopus mascot at the extreme left of the Windows 11 taskbar:

```text
[ 🐙 57% ]        [ centered Windows applications ]        [ system tray ]
```

It is an optional, always-on companion. The main panel is unchanged; all provider,
account, network and task logic stays in the SHADOWOKX process.

## Mode verdict: why reserved space is not used

The requirement was to reserve real taskbar space so app icons cannot overlap the
widget. On **stock Windows 11 that is not safely possible**, and this build does not
fake it:

- The Windows 11 taskbar is a XAML surface owned by `explorer.exe`. It exposes **no
  public API** to insert an element or reserve an interior region.
- **DeskBands** (the old `IBandSite` taskbar bands) were removed in Windows 11.
- **`SHAppBarMessage` AppBars** reserve a whole screen edge (and change the desktop
  work area); they cannot carve a slot out of the taskbar interior. Registering one on
  the taskbar's edge conflicts with the shell.
- Shell toolbars (`Shell_TrayWnd` → `ToolbarWindow32`) are not supported by the
  Windows 11 taskbar.
- The only tools that truly reserve in-taskbar space (ExplorerPatcher, StartAllBack)
  **inject into / patch explorer.exe**. The project's safety rules forbid that, and it
  is exactly the kind of fragile change that breaks on every Windows update.

So `TaskbarIntegrationCompatibility` reports **UNSUPPORTED** on current Windows 11
builds, and `Auto` resolves to the **Overlay** mode. No Explorer injection, no memory
patching, no binary patches, no kernel hooks, and no provider logic inside explorer.

If a future Windows build exposes a supported reservation API, it can be added behind
`TaskbarProbe.EvaluateCompatibility` without touching the overlay implementation.

## Hybrid modes

| Mode | Behavior |
| --- | --- |
| Auto (default) | Integrated only when the compatibility check returns SUPPORTED; otherwise Overlay |
| Integrated | Requests a reserved slot; falls back to Overlay whenever the check is not SUPPORTED |
| Overlay | Always the transparent taskbar-attached widget |

The resolution is a pure function (`TaskbarWidgetGeometry.Resolve`) and is unit
tested: an unsupported/unknown build can never select Integrated.

## How the overlay works

A single layered Win32 window created with `CreateWindowEx` (class `STATIC`) using
`WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST`:

- `WS_EX_NOACTIVATE` + returning `MA_NOACTIVATE` from `WM_MOUSEACTIVATE` means it never
  takes keyboard focus; animation and refreshes never steal focus from another app.
- `WS_EX_TOOLWINDOW` keeps it out of the taskbar and Alt+Tab.
- Pixels are composed in-process (premultiplied BGRA) and pushed with
  `UpdateLayeredWindow`, so the transparent background shows the real taskbar and only
  the mascot + text pixels are hit-testable. Clicking them toggles the panel.
- The mascot is extracted from the **same shared Clawd/octopus `.ico` frames and
  `animations.json`** the panel uses (`GetIconInfo` + `GetDIBits`), and the percentage
  uses the **same shared status color scale** (`UsageAnalytics.CapacityColor`).

### Placement

`TaskbarWidgetGeometry` places the widget at `taskbar.Left + 4 px`, vertically
centered, sized from the **real** taskbar height (never a fixed 48 px) and DPI. The
widget width is measured from the actual rendered mascot and text, so it is ~70–100 px
at 100% and scales with DPI.

### Geometry at 100 / 125 / 150%

Taskbar height and DPI are queried live (`GetWindowRect`, `GetDpiForWindow`). For a
48 px taskbar the mascot is 28 px and the row is 34 px tall; the width is measured from
"97%" plus a 28 px mascot. At 125% the vertical padding rounds 3 → 4 px; at 150% 4.5 → 5
px. Exact pixel widths are computed at runtime, not hard-coded.

## Lifecycle and safety

- **Explorer restart**: the widget window is a top-level window, so it receives the
  shell's `TaskbarCreated` broadcast. On receipt it re-probes the taskbar, re-evaluates
  compatibility, and re-places itself. The widget window is ours and survives Explorer
  restart; nothing is leaked and no duplicate instance is created.
- **Auto-hide**: `SHAppBarMessage(ABM_GETSTATE)` detects auto-hide, and the taskbar's
  live rect is compared against the monitor. When the taskbar is slid off the edge the
  widget hides; when it returns the widget reappears.
- **Fullscreen**: `SHQueryUserNotificationState` (D3D fullscreen / presentation) plus a
  foreground-window-covers-monitor check hide the widget while fullscreen apps run.
- **Multi-monitor / resolution**: the snapshot always targets `Shell_TrayWnd` (the
  primary taskbar) and its monitor. `WM_DISPLAYCHANGE`/`WM_DPICHANGED` and shell
  location events re-probe. Secondary taskbars are intentionally ignored.
- **No polling**: updates are event-driven (`SetWinEventHook` for taskbar location and
  foreground changes, plus the window messages above). Idle CPU is effectively zero;
  the frame timer runs **only** while a real task is busy.
- **Clean shutdown**: `Dispose` unhooks the WinEvent hooks, stops the timer, destroys
  the DIB/DC/font, restores the previous window procedure, and destroys the window. The
  taskbar returns to its exact normal state; nothing is ever written into explorer.

## Mascot semantics (task-only)

`widgetBusy = codexTaskBusy || commandCodeTaskBusy`, taken from the **existing**
detectors — never from window/process presence, CPU or network:

- Codex: `AppHost.CodexBusy` from the existing `CompanionActivityReader`.
- Command Code: `AppHost.CommandCodeBusy` from the existing desktop-log turn monitor.

Open + idle is static; a real turn animates the shared work sequence (intro → loop);
completion, cancellation and errors return to the static `robot-awake` frame.

## Percentage source

One value: the panel computes the selected provider's remaining percentage once
(`AllowanceValue`), displays it, sends it to the tray icon, and passes the same integer
to the companion. Stale Command Code percentages are hidden exactly as in the panel.

## Settings

**Settings → Appearance → Taskbar widget** (On/Off) and **Taskbar integration**
(Auto / Integrated / Overlay). Auto is recommended.

## Logging

Transition-only diagnostics are written to `%TEMP%\ShadowokxPanel-startup.log`:

```text
[TaskbarWidget] integration Unsupported: Windows build ... no public API ...
[TaskbarWidget] mode: overlay fallback
[TaskbarWidget] provider: commandcode
[TaskbarWidget] allowance: 57%
[TaskbarWidget] busy: false -> true
[TaskbarWidget] mascot animation started
[TaskbarWidget] busy: true -> false
[TaskbarWidget] mascot animation stopped
```

Frames are never logged.

## Validation status

The pure logic (mode resolution, geometry, DPI scaling, visibility rules, percentage
sourcing, busy flag) is covered by `TaskbarWidgetTests` and runs on any OS. **The
native window, taskbar placement, Explorer-restart, auto-hide, DPI and packaged build
must be validated on a real Windows 11 machine** — see the checklist below. No Windows
host was available in this environment, so those results and screenshots are still
outstanding.

### Windows validation checklist

1. `windows/scripts/build.ps1 -Configuration Release -Runtime win-x64`, then run the
   packaged `ShadowokxPanel.exe`.
2. Taskbar centered: `[ 🐙 57% ]` appears at the far left, vertically centered.
3. Command Code closed → static; open idle → static; real turn → animates; complete /
   cancel / error → static. Same for a real Codex task.
4. Open many apps: confirm the widget is not overlapped (overlay mode draws above the
   taskbar; it does not reserve space).
5. Switch taskbar alignment to Left; confirm the widget does not overlap Start.
6. Restart Explorer (`taskkill /f /im explorer.exe && start explorer`) — widget returns.
7. Enable taskbar auto-hide; confirm the widget hides/shows with the taskbar.
8. Repeat at 100 / 125 / 150% scaling.
9. Exit SHADOWOKX; confirm the taskbar is completely normal.

# Shadowokx Panel for Windows

Shadowokx Panel for Windows is the native Windows companion to the GNOME extension. It is a C#/.NET 8 and WinUI 3 notification-area application using the Windows App SDK. It does not embed a browser, inject into Explorer, or require administrator privileges.

> Release status: the Windows source, tests, portable publishing workflow, and per-user installer definition are implemented. A real Windows 11 build and manual QA pass are still required before publishing the first Windows binary. The Linux release remains independent.

## Experience

- One notification-area icon; left click toggles the panel.
- Native right-click menu: Open, Refresh, Settings, Start with Windows, and Exit.
- Compact popup placed within the current monitor's taskbar work area.
- Equal-width ChatGPT Codex and Weather navigation.
- Weekly remaining capacity, reset information, five-hour availability, reset credits, account-side lifetime total, and local token history.
- Truthful seven-day graph with real date spacing, a zero baseline, rounded curves, restrained fill, point tooltips, and no redraw timer.
- Current weather, feels-like temperature, humidity, wind, rain, UV, high/low, hourly forecast, sunrise, and sunset.
- Shadow, Midnight, Graphite, Nord, AMOLED, Light, and Follow Windows themes.
- Rose, Orange, Emerald, Cyan, Blue, Violet, Amber, Monochrome, and custom accents.
- Compact and Comfortable density.

## Requirements

- Windows 11, version 22H2 or newer recommended.
- x64 or ARM64.
- Codex installed and signed in to show account usage.
- Internet access for Open-Meteo Weather.

Published builds are self-contained and do not require Visual Studio or a separately installed .NET runtime.

## Installation

When release artifacts are available, use either:

1. `ShadowokxPanel-1.0.0-win-x64-setup.exe` for a per-user installation, or
2. the portable ZIP, extracted to a user-writable directory.

The installer uses `%LOCALAPPDATA%\Programs\Shadowokx Panel` and requests no elevation. Start Shadowokx Panel from the Start menu; it remains in the notification area when the popup is closed.

To uninstall an installed build, use **Settings → Apps → Installed apps → Shadowokx Panel → Uninstall**. Runtime data is intentionally preserved so upgrades do not erase history. It can be removed manually from `%LOCALAPPDATA%\ShadowokxPanel` after exiting the app.

## Codex auto-detection

The app checks the effective Windows `PATH` first, followed by current-user and established package-manager locations derived from environment variables:

- `%APPDATA%\npm`
- `%LOCALAPPDATA%\pnpm` and `%PNPM_HOME%`
- `%USERPROFILE%\.bun\bin` and `%BUN_INSTALL%\bin`
- `%USERPROFILE%\.volta\bin` and `%VOLTA_HOME%\bin`
- `%NVM_SYMLINK%` and the nvm-windows directory
- `%USERPROFILE%\scoop\shims`
- `%ChocolateyInstall%\bin`
- `%LOCALAPPDATA%\Microsoft\WindowsApps`
- user-local Programs directories and standard Program Files locations

Both native `codex.exe` and npm-style `codex.cmd`/`codex.bat` shims are supported. Native executables are launched directly. Command shims are accepted only at absolute, metacharacter-safe paths and are invoked through the system `cmd.exe` with a fixed argument sequence. No user-entered command is evaluated.

Shadowokx Panel starts `codex app-server --stdio` and requests only:

```text
account/usage/read
account/rateLimits/read
```

It never searches for, reads, copies, or stores Codex authentication files.

## Privacy and storage

Runtime state is isolated to the current Windows profile:

```text
%LOCALAPPDATA%\ShadowokxPanel\settings.json
%LOCALAPPDATA%\ShadowokxPanel\cache\codex.json
%LOCALAPPDATA%\ShadowokxPanel\cache\weather.json
%LOCALAPPDATA%\ShadowokxPanel\data\codex-history.json
%LOCALAPPDATA%\ShadowokxPanel\logs\shadowokx-panel.log   (debug only)
```

- Current limits and reset times come from the current user's local Codex app-server.
- Graph history belongs to Shadowokx Panel and accumulates one real current-day sample at a time.
- Earlier account-side daily buckets are not imported into a fresh local history.
- New installations show **Not enough history yet** until at least two real days exist.
- Authentication tokens, account email, profile, session IDs, and cookies are neither requested nor stored.
- Debug logging is disabled by default and redacts credential-shaped values.
- The configured location is sent to Open-Meteo's geocoding service, followed by latitude/longitude sent to its forecast service. No Weather API key is used.

## Start with Windows

The optional startup switch creates a value under the current user's standard `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` key. It starts the application with `--startup`, which creates the tray icon without opening the popup. Disabling the switch removes only Shadowokx Panel's value.

## Architecture

```text
windows/
├── src/ShadowokxPanel.Core/     providers, normalization, history, storage
├── src/ShadowokxPanel/          WinUI popup, tray, settings, themes, platform APIs
├── tests/                       xUnit pure-logic and provider tests
├── packaging/                   per-user Inno Setup definition
└── scripts/                     build, test, package, and isolation checks
```

The core library has no WinUI dependency. Provider state is structured and the UI does not parse raw Codex or Open-Meteo responses.

## Development

Install a current Visual Studio release with the .NET desktop/Windows App SDK workload, or an equivalent Windows environment with .NET 8 and Windows App SDK build support. The project pins Windows App SDK 2.4.0.

```powershell
cd windows
.\scripts\test.ps1
.\scripts\build.ps1 -Configuration Release -Runtime win-x64
.\scripts\package.ps1 -Runtime win-x64
```

`package.ps1` always creates a portable ZIP. If Inno Setup 6 is installed and `ISCC.exe` is available, it also creates the per-user installer.

## Feature parity

| Feature | Linux / GNOME | Windows |
|---|---:|---:|
| Codex weekly limit and reset | ✅ | ✅ Implemented |
| Five-hour window | ✅ | ✅ Implemented when reported |
| Reset credits | ✅ | ✅ Implemented |
| Lifetime token total | ✅ | ✅ Implemented |
| Privacy-safe local history | ✅ | ✅ Implemented per Windows user |
| Seven-day graph and point tooltips | ✅ | ✅ Implemented with WinUI shapes |
| Idle / Steady / Peak pace | ✅ | ✅ Same thresholds |
| Open-Meteo Weather | ✅ | ✅ Implemented |
| Hourly rain, UV, sunrise/sunset | ✅ | ✅ Implemented |
| Cached/stale provider states | ✅ | ✅ Implemented |
| GNOME top bar | ✅ | ⚠ Native notification-area tooltip/icon |
| GNOME popup | ✅ | ⚠ Native taskbar-adjacent WinUI popup |
| GNOME preferences | ✅ | ⚠ Native Windows settings window |
| Start at login | N/A | ✅ Current-user startup value |
| Per-monitor DPI | GNOME-managed | ✅ PerMonitorV2 manifest and WinUI scaling |
| System theme | ✅ | ✅ Follow Windows |
| Linux summary PNG sharing | ✅ | ❌ Not included in Windows 1.0 source |

## Performance and lifecycle

- Only one application instance is registered per Windows user; later launches redirect to it.
- Concurrent manual refreshes are coalesced.
- Provider requests are asynchronous, cancellable, size-bounded, and time-bounded.
- The graph redraws only when data or layout size changes.
- The minute display timer runs only while the popup is visible.
- Weather makes no requests while disabled.
- Suspend/resume rechecks stale providers without creating new timers or tray icons.
- Tray hooks, timers, requests, providers, and event subscriptions are removed during exit.

## Troubleshooting

### Codex not detected

Confirm that `codex --version` works for the same Windows user. If it is installed in an unusual location, expose it through that user's `PATH` or a supported package-manager location, then restart Shadowokx Panel.

### Codex usage unavailable

Open Codex and confirm that it is signed in. Shadowokx Panel does not accept or store an API key.

### Weather unavailable

Check the network and use a location such as `Cairo, Egypt`. The last matching cached forecast remains visible during temporary failures.

## Known limitations

- Windows runtime, installer, DPI, sleep/resume, and notification-area behavior still require validation on real Windows 11 hardware before the first binary release.
- Exotic Codex installations outside `PATH` and the documented locations are not detected automatically.
- Local history is scoped to the Windows login, not to a stored Codex account identifier. Switching Codex accounts under one Windows login retains that local history.
- The first graph requires two daily samples; pace state requires four completed days.
- Summary-image export is not part of the initial Windows implementation.

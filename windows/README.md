# Shadowokx Panel for Windows

Shadowokx Panel is a native Windows 11 notification-area companion for Codex usage and Weather. It uses C#/.NET 8, WinUI 3, and the Windows App SDK—without embedding a browser, injecting into Explorer, or requiring administrator privileges.

## Install on Windows 11

Recommended:

1. Download `ShadowokxPanel-Setup-x64.exe`.
2. Open it.
3. Click **Install**.
4. Launch Shadowokx Panel.

The only file a normal user needs is:

```text
ShadowokxPanel-Setup-x64.exe
```

The installer:

- installs for the current user under `%LOCALAPPDATA%\Programs\Shadowokx Panel`;
- adds Shadowokx Panel to the Start menu;
- can launch the app when setup finishes;
- requires no administrator approval; and
- includes .NET and Windows App SDK runtime files, so no separate runtime, SDK, or Visual Studio installation is needed.

Windows may show an **Unknown publisher** or Microsoft Defender SmartScreen message for an unsigned community build. Verify the file against `checksums.txt` and download releases only from the project’s official GitHub release page. A signed build will display the certificate publisher instead.

For an advanced no-installer workflow, download `ShadowokxPanel-Portable-x64.zip`, extract the entire archive to a user-writable directory, and run `ShadowokxPanel.exe`. Do not run the executable from inside the ZIP.

To uninstall, use **Settings → Apps → Installed apps → Shadowokx Panel → Uninstall**. Uninstall removes the application and its shortcuts but intentionally preserves settings, cache, and history in `%LOCALAPPDATA%\ShadowokxPanel`.

## Requirements

- Windows 11 22H2 or newer recommended.
- x64 for the recommended installer; ARM64 portable builds may be produced separately.
- Codex installed and signed in to display account usage.
- Internet access for Open-Meteo Weather.

## Experience

- Dedicated multi-resolution notification-area icon; left click toggles the compact taskbar-free panel.
- Right-click menu: Open, Refresh, Settings, Start with Windows, and Exit.
- Equal-width ChatGPT Codex and Weather navigation.
- Weekly capacity, reset information, five-hour availability, reset credits, lifetime token total, and privacy-safe local history.
- Seven-day graph with real date spacing, a zero baseline, point tooltips, and no redraw timer.
- Current Weather, hourly forecast, rain, UV, high/low, sunrise, and sunset with bundled vector condition icons.
- Multiple native themes, accent choices, and compact/comfortable density.

Closing the popup leaves Shadowokx Panel running in the notification area. Use **Exit** from the tray menu to stop it completely.

## Privacy and storage

Runtime state is isolated to the current Windows profile:

```text
%LOCALAPPDATA%\ShadowokxPanel\settings.json
%LOCALAPPDATA%\ShadowokxPanel\cache\codex.json
%LOCALAPPDATA%\ShadowokxPanel\cache\weather.json
%LOCALAPPDATA%\ShadowokxPanel\data\codex-history.json
%LOCALAPPDATA%\ShadowokxPanel\logs\shadowokx-panel.log   (debug only)
```

- The installer never writes user data into its installation directory.
- Upgrades and normal uninstall preserve runtime data.
- Codex limits come from the current user’s local Codex app-server.
- Shadowokx Panel never searches for or stores Codex credentials, tokens, account email, cookies, or session IDs.
- The configured location is sent to Open-Meteo for geocoding and forecast data; no Weather API key is used.
- Debug logging is disabled by default and redacts credential-shaped values.

## Codex detection

The app merges the process, current-user, and machine Windows `PATH`, checks the registered `codex.exe` App Path, and then checks the official standalone installer’s `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` directory plus established package-manager and per-user program locations for native `codex.exe` and npm-style `codex.cmd`/`codex.bat` shims. If the launcher is nested inside an official versioned application or native npm/pnpm payload, discovery searches only those bounded known roots and registered OpenAI install locations, preferring the native executable for the running architecture. This avoids both the stale-PATH problem and the earlier top-level-only lookup failure. It invokes the fixed `codex app-server --stdio` command and requests only:

```text
account/usage/read
account/rateLimits/read
```

No user-entered command is evaluated.

## Start with Windows

The optional setting uses the current user’s standard `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` key. It starts Shadowokx Panel with `--startup`, creating the tray icon without opening the popup. Disabling the setting removes only Shadowokx Panel’s own value.

## Architecture

```text
windows/
├── src/ShadowokxPanel.Core/     providers, normalization, history, storage
├── src/ShadowokxPanel/          WinUI popup, tray, settings, platform APIs
├── tests/                       xUnit pure-logic and provider tests
├── packaging/                   per-user Inno Setup definition
├── docs/                        Windows release QA
└── scripts/                     build, release, validation, and isolation checks
```

The core library has no WinUI dependency. Provider state is structured, storage uses bounded atomic writes, and the UI does not parse raw service responses.

## Developer build

Use Windows 11 with the .NET 8 SDK and Windows App SDK build support. Inno Setup 6 is also required to create the recommended x64 installer.

```powershell
cd windows
.\scripts\test.ps1
.\scripts\build.ps1 -Configuration Release -Runtime win-x64
```

`build.ps1` restores packages, runs strict tests/analyzers, creates a self-contained unpackaged WinUI publish, and validates its executable, application PRI, every project XBF, assets, and native runtimes. A successful publish is written to `artifacts\win-x64`.

## Create release artifacts

From the `windows` directory, run:

```powershell
.\scripts\release.ps1 -Configuration Release -Runtime win-x64
```

The command fails if tests, publishing, resource validation, ZIP validation, or installer compilation fails. It creates:

```text
artifacts\release\ShadowokxPanel-Setup-x64.exe
artifacts\release\ShadowokxPanel-Portable-x64.zip
artifacts\release\checksums.txt
```

`package.ps1` remains as a compatibility wrapper around the same release pipeline.

### Optional Authenticode signing

No certificate or private key is stored in this repository. To sign with a certificate already installed in the Windows certificate store, set its thumbprint and optionally the SignTool path:

```powershell
$env:SHADOWOKX_SIGN_CERT_THUMBPRINT = 'CERTIFICATE_THUMBPRINT'
$env:SHADOWOKX_SIGNTOOL = 'C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64\signtool.exe'
.\scripts\release.ps1 -Configuration Release -Runtime win-x64
```

When signing is configured, the pipeline signs and verifies both the application executable and installer with SHA-256 and a timestamp. Without a certificate it produces truthful unsigned artifacts and prints a warning; it never creates or trusts a fake certificate.

Before publishing, complete [the Windows release QA checklist](docs/RELEASE-QA.md) on a normal Windows 11 account and test the installed copy, not only the build output.

## Performance and lifecycle

- A single primary instance remains alive in the notification area; later launches redirect to it.
- The notification icon is rendered in memory as the current pixel-style Codex percentage, with true alpha, exact DPI sizing, and restrained capacity colors; no scaled tray bitmap is loaded.
- Codex uses one adaptive scheduler: 30 seconds while its visible page is open and 60 seconds in the background. Concurrent triggers are coalesced.
- Provider work is asynchronous, cancellable, size-bounded, and time-bounded; last-known-good data survives transient failures.
- The graph redraws only when its data or layout changes.
- The display timer runs only while the popup is visible and updates relative timestamps without rebuilding the page; Weather makes no requests while disabled.
- Identical Codex results do not rewrite daily history or cache on every short refresh.
- Tray hooks, timers, requests, providers, and event subscriptions are disposed exactly once during Exit.

## Troubleshooting

### Codex not detected

Confirm `codex --version` works for the same Windows user, then restart Shadowokx Panel. Installations exposed through `PATH`, npm, pnpm, Bun, Volta, nvm-windows, Scoop, Chocolatey, WindowsApps, standard user/program directories, and versioned OpenAI application payloads are supported.

### Codex usage unavailable

Open Codex and confirm it is signed in. Shadowokx Panel does not accept or store an API key.

### Weather unavailable

Check the network and try a location such as `Cairo, Egypt`. Cached forecast data remains visible during temporary failures.

### App starts but no window appears

Check the notification-area overflow. A tray-first launch intentionally keeps the popup closed. Development startup diagnostics are written to `%TEMP%\ShadowokxPanel-startup.log`.

## Known limitations

- Unsigned builds can trigger SmartScreen until the project establishes signed release reputation.
- Exotic Codex installations outside `PATH` and documented package-manager locations are not detected automatically.
- Local history belongs to the Windows login, not a stored Codex account identifier.
- A new installation needs two real daily samples for a graph and four completed days for pace classification.
- Summary-image export is not included in the initial Windows release.

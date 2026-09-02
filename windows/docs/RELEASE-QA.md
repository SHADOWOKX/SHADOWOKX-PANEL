# Windows release QA checklist

Complete this checklist on a real Windows 11 x64 machine using the exact files intended for release. Test with a standard, non-administrator account and test the installed application—not a copy under `bin`, `obj`, or the repository.

Record the Windows version, release commit, application version, installer SHA-256, tester, and date with the release notes.

## 1. Build and artifact gate

- [ ] Delete `bin`, `obj`, and `artifacts`, then run `.\scripts\release.ps1 -Configuration Release -Runtime win-x64`.
- [ ] All tests and strict analyzers pass.
- [ ] The command finishes without a skipped or failed validation step.
- [ ] `ShadowokxPanel-Setup-x64.exe`, `ShadowokxPanel-Portable-x64.zip`, and `checksums.txt` exist under `artifacts\release`.
- [ ] `Get-FileHash -Algorithm SHA256` matches every line in `checksums.txt`.
- [ ] The portable ZIP contains `ShadowokxPanel.exe`, `ShadowokxPanel.dll`, `ShadowokxPanel.Core.dll`, `ShadowokxPanel.pri`, all XBF files, `Assets`, .NET runtime files, and Windows App SDK runtime files.
- [ ] The ZIP contains no PDB files, `bin`, `obj`, `TestResults`, machine-specific user paths, credentials, logs, cache, or history.
- [ ] If this is a signed release, `signtool verify /pa` succeeds for both the app executable in the release payload and the installer.

## 2. Fresh per-user install

- [ ] Exit every existing Shadowokx Panel process from its tray menu.
- [ ] Remove any older test installation without deleting `%LOCALAPPDATA%\ShadowokxPanel` unless this test explicitly requires a clean profile.
- [ ] Run `ShadowokxPanel-Setup-x64.exe` as a normal user.
- [ ] Setup does not request administrator elevation.
- [ ] The default destination is `%LOCALAPPDATA%\Programs\Shadowokx Panel`.
- [ ] The Start menu shortcut is created and opens the installed copy.
- [ ] The optional desktop shortcut is absent by default and works when selected.
- [ ] **Launch Shadowokx Panel** is offered at completion and starts the app.
- [ ] Installed Apps shows the correct product name, publisher, version, and icon.
- [ ] The installation directory contains the app PRI and every XBF from the validated payload.
- [ ] `%TEMP%\ShadowokxPanel-startup.log` records `WinUI framework resources initialized`, `MainWindow InitializeComponent successful`, `graph construction successful`, `tray initialization successful`, and `app entering steady-state` in that order.

## 3. Startup, tray, and single-instance lifecycle

- [ ] First launch creates one `ShadowokxPanel` process that remains alive for at least 30 seconds.
- [ ] One Shadowokx Panel tray icon appears; its tooltip and pixel percentage are correct at normal DPI.
- [ ] Left click opens the popup near the current taskbar work area.
- [ ] Closing the popup hides it without terminating the process.
- [ ] Reopen and close the popup at least twenty times; no duplicate tray icons, timers, handles, or processes appear.
- [ ] The main popup never creates a taskbar button and is absent from normal Alt-Tab switching; Settings remains an intentional normal window.
- [ ] ESC and clicking outside hide the popup without exiting the process.
- [ ] Inspect tray values `100%`, a two-digit value, and a one-digit value at 100%, 125%, 150%, and 200%: white digits are large and centered, the tooltip contains the `%` value, corners are fully transparent, edges have no halo, and every mark remains crisp.
- [ ] Launch the Start menu shortcut again; the second process redirects to the existing primary instance and exits.
- [ ] The primary process and tray icon remain alive after secondary activation.
- [ ] Right-click **Open**, **Refresh**, **Settings**, and **Start with Windows** work.
- [ ] Closing and reopening Settings does not create duplicate windows, subscriptions, or errors.
- [ ] Tray **Exit** removes the tray icon and terminates the primary process cleanly.
- [ ] Relaunch after Exit succeeds normally.

## 4. Functional smoke test

- [ ] Codex reports current structured usage when Codex is installed and signed in.
- [ ] Codex discovery succeeds independently for process PATH, user PATH, machine PATH, registered App Paths/install locations, versioned OpenAI payloads, npm, pnpm, Bun, Volta, nvm-windows, Scoop, Chocolatey, and WindowsApps installations available to the current user.
- [ ] Found-but-cannot-start, app-server failure, signed-out, malformed-response, and timeout cases produce distinct concise states without revealing paths or protocol payloads.
- [ ] Codex unavailable state is truthful and the application remains usable when Codex is absent or signed out.
- [ ] Startup, popup-open, Codex-tab selection, and manual actions refresh immediately; visible cadence is about 30 seconds and hidden cadence about 60 seconds.
- [ ] Manual and automatic refresh do not overlap, blank cached data, inflate same-day history, or create extra processes.
- [ ] Weather refresh displays current and hourly data for a valid location.
- [ ] Codex and Weather fit their normal content without visible vertical scrollbar chrome; constrained work areas retain wheel/touch scrolling.
- [ ] Clear day/night, partly cloudy day/night, cloud, overcast, fog, drizzle, rain, heavy rain, snow, showers, thunderstorm, and unknown all render app-owned icons—never missing-glyph squares.
- [ ] Cached Weather remains visible during a temporary network failure.
- [ ] Theme, accent, density, Weather visibility, and startup settings persist after full Exit and relaunch.
- [ ] Token history adds only valid canonical samples and is preserved after relaunch.
- [ ] Graph layout and tooltips remain correct with insufficient, two-point, and seven-day history.

## 5. Display, power, and resilience

- [ ] Popup placement is correct with the taskbar on each supported edge.
- [ ] Popup and tray icon are correct at 100%, 125%, 150%, and 200% scaling where available.
- [ ] Move between monitors with different DPI; placement and sizing remain usable.
- [ ] Light, dark, and high-contrast-adjacent Windows settings keep text and controls readable.
- [ ] Lock/unlock and sleep/resume do not create duplicate timers, tray icons, refreshes, or windows.
- [ ] Disconnect/reconnect networking; cached state remains and later refresh recovers.
- [ ] Review `%TEMP%\ShadowokxPanel-startup.log` and application debug logs for unexpected exceptions or sensitive data.

## 6. Start with Windows

- [ ] Enable **Start with Windows**, sign out and back in, and confirm one hidden tray-first instance starts.
- [ ] No popup opens automatically during `--startup` activation.
- [ ] Disable the setting and confirm Shadowokx Panel removes only its own `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value.
- [ ] Enable it again before the upgrade test to verify upgrade preservation.

## 7. Upgrade in place

- [ ] With the previous released version installed, create recognizable settings, cache, and token-history state.
- [ ] Install the new setup executable without manually uninstalling the old version.
- [ ] Setup reuses the existing install location and does not request elevation.
- [ ] Only one Installed Apps entry and one Start menu shortcut remain.
- [ ] Launching the upgraded app uses the new binary and resource payload.
- [ ] Settings, history, cache, selected theme, location, and Start-with-Windows choice remain intact.
- [ ] No obsolete application files or stale XBF/PRI resources interfere with startup.

## 8. Uninstall

- [ ] Exit the app from the tray before uninstalling, or confirm setup closes it cleanly when prompted.
- [ ] Uninstall from Settings → Apps → Installed apps.
- [ ] The application process stops and the tray icon disappears.
- [ ] The installation directory, Start menu shortcut, optional desktop shortcut, and startup registry value are removed.
- [ ] `%LOCALAPPDATA%\ShadowokxPanel` remains intact by design.
- [ ] Reinstalling restores access to the preserved settings/history.
- [ ] If testing complete data removal, exit/uninstall first and delete `%LOCALAPPDATA%\ShadowokxPanel` manually; the uninstaller must never do this automatically.

## 9. Portable artifact

- [ ] Extract the full ZIP into a new user-writable directory outside the repository.
- [ ] Run `ShadowokxPanel.exe` without installing .NET, Windows App SDK, Visual Studio, or an SDK.
- [ ] Startup, tray, popup, Settings, provider refresh, single-instance redirect, and Exit all work.
- [ ] Portable runtime data still uses `%LOCALAPPDATA%\ShadowokxPanel`; it is not written beside the executable.
- [ ] Deleting the extracted directory after Exit does not delete user data.

## 10. SmartScreen and final sign-off

- [ ] Test the downloaded artifact (preserving Mark-of-the-Web), not only a locally built file.
- [ ] Signed release: Windows displays the expected certificate publisher and signature verification succeeds.
- [ ] Unsigned release: release notes clearly disclose **Unknown publisher**/SmartScreen behavior and provide the SHA-256 checksums; do not imply that unsigned binaries are trusted.
- [ ] No secrets, signing certificates, private keys, tokens, personal paths, caches, or logs are present in Git or release files.
- [ ] Every failure found above is fixed and the checklist is rerun before the GitHub release is published.

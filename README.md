# Shadowokx Panel

A lightweight cross-platform panel for checking **ChatGPT Codex usage** and **local weather** from one place.

Linux `2.3.9` · Windows `2.1 Preview 2`.

- Weekly and 5-hour Codex limits
- Four animated companions: Shadow Robot, Codex Companion, Clawd (official pixel companion) and Penguin
- Terminal, Clay and Glacier themes alongside the existing surface presets
- Compact account activity heatmap with daily and weekly views
- Local weather, UV, hourly forecast, and sunrise/sunset
- Native Linux and Windows interfaces
- Custom themes, colors, density, and panel width
- Cached data during temporary connection failures
- No telemetry or analytics

## Linux (GNOME)

Tested on Ubuntu 26.04.1 LTS, GNOME Shell 50.x and Wayland.

### Install or update — one command

Requires **GNOME Shell 50**, GJS 1.88+ and `curl` (Ubuntu 26.04.1 / Wayland).
Codex usage requires the local Codex client signed in with your ChatGPT account.

Run the same command for a fresh install or an update:

```bash
curl -fsSL https://github.com/SHADOWOKX/SHADOWOKX-PANEL/releases/download/linux-latest/install-linux.sh | sh
```

Downloads the ready-built Linux package, verifies its SHA-256 checksum and installs it for your user. No Git clone or `sudo` is needed. **Log out and back in** to load the new version. If the panel is not visible afterward, enable it with `gnome-extensions enable shadow-panel@shadowokx`.

[**Download ZIP**](https://github.com/SHADOWOKX/SHADOWOKX-PANEL/releases/download/linux-latest/shadow-panel@shadowokx.shell-extension.zip) · [Release notes](https://github.com/SHADOWOKX/SHADOWOKX-PANEL/releases/tag/linux-latest) · [SHA-256](https://github.com/SHADOWOKX/SHADOWOKX-PANEL/releases/download/linux-latest/checksums-linux.txt)

### Screenshots

#### Codex usage

<p align="center">
  <a href="assets/linux-codex-v2.png">
    <img src="assets/linux-codex-v2.png" alt="Shadowokx Panel Codex usage view on Linux GNOME" width="445">
  </a>
</p>

#### Weather

<p align="center">
  <a href="assets/linux-weather-v2.png">
    <img src="assets/linux-weather-v2.png" alt="Shadowokx Panel weather view on Linux GNOME" width="444">
  </a>
</p>

#### GNOME top bar

<p align="center">
  <a href="assets/linux-tray.png">
    <img src="assets/linux-tray.png" alt="Shadowokx Panel indicators in the Linux GNOME top bar" width="155">
  </a>
</p>

### Linux account usage

Displayed token counts and allowance percentages come from the signed-in Codex
account read endpoints. Missing current-day usage is shown as pending with the
latest returned account date. The seven-day row states how many of its dates were
reported. No local totals or lifetime deltas substitute for
missing account dates. The activity card keeps up to twelve months of returned
account dates, with daily cells or weekly sums in the same compact space. Hover or
use the arrow keys to inspect exact values; weekly details include reported-day
coverage. Blank dates are unreported, not assumed zero. Peak labels refer to the
displayed period and selected daily or weekly view. The account response does not
provide a billed dollar value.

A separate compact **device estimate** shows today's and the last seven days' USD
value from recorded local Codex sessions, following the approach documented by
[CodexBar](https://github.com/steipete/CodexBar/blob/main/docs/providers.md).
Includes GPT-6.1 Sol pricing (input $2, cached input $0.10, output $10 per million tokens), checked September 30, 2026 on the [official model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol). It applies [official model prices](https://developers.openai.com/api/docs/pricing)
to recorded uncached input, cached input, cache writes and output, including the
long-context premium. It never multiplies account totals by a guessed model mix.
Unknown models remain unpriced; only affected periods carry a partial asterisk.
The dollar section appears when local session data is available. These values
cover this device's recorded sessions, not an account bill. Standard rates exclude
fast-mode premiums and tool fees. Hover a value for its scope and pricing date.

The cost scan runs in a low-priority worker while the Codex page is visible, at
most once a minute, and reuses unchanged session-file metadata from a private
cache. It does not block account limit refreshes.

Refresh sends only initialization and account read requests. It does not start a
thread or model turn. Remaining allowance colors follow a shared red → orange →
amber → green scale across the percentage, progress bar, and top-bar summary.

Linux packages are built by GitHub Actions. Versioned releases preserve each package; the `linux-latest` download always points to the newest published Linux build.

## Windows 11

### [Download the latest Windows Setup (x64)](https://github.com/SHADOWOKX/SHADOWOKX-PANEL/releases/download/windows-v2.1.0-preview.2/ShadowokxPanel-Setup-x64.exe)

Download the Setup, open it, and install. It is self-contained and does not require the .NET SDK, Visual Studio, or administrator privileges.

### Screenshots

#### Codex usage

<p align="center">
  <a href="assets/windows-codex.png">
    <img src="assets/windows-codex.png" alt="Shadowokx Panel Codex view on Windows" width="562">
  </a>
</p>

#### Weather

<p align="center">
  <a href="assets/windows-weather.png">
    <img src="assets/windows-weather.png" alt="Shadowokx Panel Weather view on Windows" width="548">
  </a>
</p>

#### Windows system tray

<p align="center">
  <a href="assets/windows-tray.png">
    <img src="assets/windows-tray.png" alt="Shadowokx Panel Windows system tray icon" width="250">
  </a>
</p>

> The current Windows build is unsigned, so SmartScreen may show an **Unknown publisher** warning.

[Windows source and documentation](https://github.com/SHADOWOKX/SHADOWOKX-PANEL/tree/windows-port)

## Privacy

Shadowokx Panel uses the signed-in local Codex client for usage data and Open-Meteo for weather. The extension does not read Codex credentials and does not include telemetry or analytics.

The mascot watches local Codex session-file notifications and reads only appended event records to identify work activity; it does not retain prompt or response content.

Weather data is provided by [Open-Meteo.com](https://open-meteo.com/) under its [CC BY 4.0 data licence](https://open-meteo.com/en/license). Open-Meteo service terms and privacy information are available [here](https://open-meteo.com/en/terms).

## Code signing policy

Windows releases follow the project's documented code-signing process.

See [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md).

Free code signing provided by SignPath.io, certificate by SignPath Foundation.

## Development

Run the project checks:

```bash
./scripts/check.sh
```

Build the installable package:

```bash
./scripts/package.sh
```

## Contributors

- [SHADOWOKX](https://github.com/SHADOWOKX) — creator and maintainer

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).

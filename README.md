# Shadowokx Panel

A lightweight cross-platform panel for checking **ChatGPT Codex usage** and **local weather** from one place.

Linux `2.3.4` · Windows `1.0.0`.

- Weekly and 5-hour Codex limits
- Original Shadowokx mascot with idle, awake, and active states
- Token activity and seven-day history
- Local weather, UV, hourly forecast, and sunrise/sunset
- Native Linux and Windows interfaces
- Custom themes, colors, density, and panel width
- Cached data during temporary connection failures
- No telemetry or analytics

## Linux (GNOME)

Tested on Ubuntu 26.04.1 LTS, GNOME Shell 50.x and Wayland.

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

### Requirements

- Ubuntu 26.04.1 LTS
- GNOME Shell 50.x
- Wayland
- GJS 1.88 or newer
- Git

### Download Linux package

[**Download Shadowokx Panel 2.3.4 for Linux (GNOME Shell 50)**](https://github.com/SHADOWOKX/SHADOWOKX-PANEL/releases/download/linux-v2.3.4/shadow-panel@shadowokx.shell-extension.zip)

[SHA-256 checksum](https://github.com/SHADOWOKX/SHADOWOKX-PANEL/releases/download/linux-v2.3.4/checksums-linux.txt)

Install the downloaded ZIP with:

```bash
gnome-extensions install --force ./shadow-panel@shadowokx.shell-extension.zip
```

Then log out and back in once and enable the extension:

```bash
gnome-extensions enable shadow-panel@shadowokx
```

### Quick install from source

```bash
git clone https://github.com/SHADOWOKX/SHADOWOKX-PANEL.git && cd SHADOWOKX-PANEL && ./install.sh
```

When the installer finishes, **log out and back in once** so GNOME Shell can load the extension.

Then enable it:

```bash
gnome-extensions enable shadow-panel@shadowokx
```

### Open preferences

```bash
gnome-extensions prefs shadow-panel@shadowokx
```

### Update

```bash
cd SHADOWOKX-PANEL
git pull
./install.sh
```

Then log out and back in once to load the updated version. If needed, enable it again with:

```bash
gnome-extensions enable shadow-panel@shadowokx
```

### Uninstall

```bash
./uninstall.sh
```

### Linux token totals and API-equivalent estimate

The Codex page shows exact **Today**, **Yesterday**, and **Last 7 Days** token counts
from the signed-in Codex account usage response. The token activity chart and its
daily statistics use those same account-reported buckets. When Codex has not returned
an account bucket for today, the panel labels it as not reported and does not substitute
local session totals. Codex returns daily dates without a published timezone/day-boundary
rule; the panel preserves those date strings and shows them beside Today/Yesterday labels.
Weekly allowance percentages are a
separate server-reported measure and cannot be converted to tokens. USD values are
approximate API-equivalent estimates: the locally observed model and cache mix is
applied to those exact account totals. This is not a Codex or ChatGPT subscription
charge; unsupported local models make the estimate partial.

Bundled standard API prices were checked on 2026-09-23 against the official
[OpenAI model pricing pages](https://developers.openai.com/api/docs/pricing). The
Linux GNOME package is built and attached as an artifact by the `Linux GNOME package`
GitHub Actions workflow for pushes to `main` and pull requests.

## Windows 11

### [Download the latest Windows Setup (x64)](https://github.com/SHADOWOKX/SHADOWOKX-PANEL/releases/latest/download/ShadowokxPanel-Setup-x64.exe)

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

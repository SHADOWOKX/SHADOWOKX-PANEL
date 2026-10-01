# Shadowokx Panel

A lightweight panel for checking **AI subscription usage** and **local weather**. Linux 3.0 adds provider logo tabs for Codex, Claude, OpenCode, Command Code, DeepSeek, GLM and Gemini; connection capabilities are detailed below. Windows remains on the Codex and Weather preview.

Linux `3.1.2` · Windows `2.1 Preview 2`.

- Provider logo buttons with settings to add, hide or remove panel connections
- Weekly and 5-hour Codex limits
- Clawd types on the original laptop animation during live Codex work and celebrates a successful completed turn
- Four animated companions: Shadow Robot, Codex Companion, Clawd (official pixel companion) and Penguin
- Fourteen surface presets including Dracula, Catppuccin, Ocean and Rosé Pine; thirteen accent colors and a custom color picker
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

## AI subscriptions · 3.0

The top selector switches between Codex, Claude, OpenCode, Command Code, DeepSeek, GLM / Z.ai, Gemini and Weather. With several providers enabled it uses compact logo buttons with tooltips and arrow-key navigation. Settings → AI providers lets you hide a provider without losing its connection, remove its panel connection, and add it again. Removing a provider never cancels the subscription or deletes provider credentials. Connections refresh every minute and when their page opens. Settings changes appear after the popup closes.

Codex continues to read the local app-server. Claude uses the official Claude Code status-line `rate_limits` fields. In Settings → AI providers → Claude, press **Connect**, restart Claude Code and send a prompt. Existing custom status lines are automatically chained, and a private `settings.shadow-panel-backup.json` preserves the original settings. The exporter stores only allowance fields, never conversation content. [Claude status-line documentation](https://code.claude.com/docs/en/statusline).

For DeepSeek, select a private text file containing only your API key. Leave the usage JSON path empty to read the official `GET https://api.deepseek.com/user/balance` endpoint. This reports **API balance**, not an invented subscription percentage. The token is read only when needed and is never stored in GSettings or logged. [DeepSeek balance documentation](https://api-docs.deepseek.com/api/get-user-balance/).

OpenCode, Command Code, GLM and Gemini currently use a **usage JSON export**. These buttons alone do not automatically retrieve account limits. Configure a source produced by your provider integration, or write it to `$XDG_CONFIG_HOME/shadow-panel/usage/<provider>.json` (default `~/.config/shadow-panel/usage/`). All non-Codex providers also accept a custom usage JSON file. The source must report real account allowance or balance, rather than context-window utilization:

```json
{
  "plan": "Your plan",
  "updatedAt": "2026-10-01T14:30:00Z",
  "windows": [
    {"label": "Weekly allowance", "usedPercent": 35, "resetsAt": "2026-10-08T14:30:00Z"}
  ],
  "balance": {"amount": 12.50, "currency": "USD"},
  "tokens": {"total": 125000}
}
```

Optional values remain hidden when absent. Missing or malformed sources show a connection message; stale sources and failed refreshes are marked, and expired windows are discarded. Authentication files do not contain enough information to infer remaining allowances, so they are not treated as usage sources. Use **Open provider dashboard** to view billing directly.

Appearance includes Dracula, Catppuccin, Ocean and Rosé Pine, plus the existing ten surface presets, light/dark/system mode, thirteen accent colors and the custom color picker.

## Companion and quick connections · 3.1

**Vary work animations** chooses laptop work, walking, jumping and waving while a task is running. Idle, app-open and popup-open states stay static; they never start an animation. The system reduced-motion setting and the animation toggle still apply. Open AI windows and supported CLI processes are detected locally every three seconds; application presence does not imply token consumption. The top-bar allowance follows the focused provider or selected provider page.

Clawd uses a fixed 26px icon allocation in every state, with vector frames centered inside that allocation. Laptop frames use the same visible character width as standing frames, so the companion does not shrink while typing.

In **Settings → AI providers**, use **Connect** for Claude, paste a DeepSeek key into its password entry and press the apply arrow, or use **Choose file…** for another provider's exported usage JSON. The file picker validates usage before connecting. Files are watched for changes, so updated exports appear immediately without waiting for the minute polling interval. Signing into the provider dashboard by itself does not make its subscription limits available: OpenCode, Command Code, GLM and Gemini still require a usage export.

### Work-only animation · 3.1.2

An open client, focused window, updated balance or usage refresh does not start the mascot. Codex uses actual task/session events. Other provider exports can explicitly report `activity: {"active": true, "updatedAt": "...", "expiresAt": "..."}`; reports must be timestamped and expire (30 seconds by default, at most two minutes per report). Without a valid task report, the companion stays still. Work stops cancel the animation immediately; sleeping poses do not schedule background movement.

### Work and allowance fixes · 3.1.2

The top-bar allowance follows the selected subscription, independent of window focus. An unconnected provider displays an explicit unavailable percentage instead of hiding the value. Codex Desktop sessions without a task-start marker are detected from model/tool work and remain active through quiet tool waits until the explicit assistant final response or task completion. Quota refreshes remain idle.

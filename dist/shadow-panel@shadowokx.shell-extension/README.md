# Shadow Panel

Shadow Panel is a compact productivity dashboard for the GNOME top bar, built for Ubuntu 26.04.1 LTS, GNOME Shell 50, Wayland, and modern GJS ES modules.

Its popup behaves like a tiny GNOME application: a minimal `Shadowokx Panel™` wordmark, icon-first expanding tabs, one focused module at a time, and clear loading, cached, empty, and recovery states. Release `1.3.1` contains Codex, Weather, and Quick Notes with optional Obsidian capture.

## Screenshots

Screenshots will be added after the first tagged release.

- Top bar: `◉ 89%   ☀ 34°   ✎ 3`
- Codex selected: `[ ◉ Codex ]   ☀   ✎`
- Weather selected: `◉   [ ☀ Weather ]   ✎`

The Codex value always means **remaining capacity**, never used capacity.

## Features

- Configurable top-bar summary for Codex remaining capacity, current temperature, and local Quick Note count. Values collapse to icons, and narrow monitors automatically limit the number of items.
- Full-contrast symbolic inactive tabs with a compact, lightly tinted icon-and-label active state, remembered/default selection, configurable order, module toggles, and horizontal overflow.
- A quiet persistent header containing only the `Shadowokx Panel™` wordmark and Settings action.
- Codex account and rate-limit data from the local machine-readable Codex app-server protocol—no rendered-page scraping and no credential storage.
- A weekly-first Codex dashboard with a compact five-hour state, reset credits, client version, cache state, and minimal actions.
- A PNG Share action that exports a polished 1200×675 usage card without overwriting earlier exports.
- Strong current-weather hero, aligned detail tiles, a clean fixed five-column forecast row, location-aware local times, rain probability context, Celsius/Fahrenheit, caching, offline recovery, and vertical overflow support for large-text accessibility.
- Quick Capture plus local note create/edit/delete/pin/copy, pinned/recent groups, destination selection, and guarded Obsidian Markdown writes.
- Open Obsidian and open the configured target folder directly from the Notes page.
- Auto, dark, and light contrast; Default, Claude-like Gray, Dark Graphite, Light Neutral, and validated Custom Tint backgrounds; two densities; eight accent presets plus custom accent.
- Native Adwaita preferences for General, Modules, Appearance, Integrations, and About.
- No telemetry or analytics.

## Supported platform

- Ubuntu 26.04.1 LTS
- GNOME Shell 50.x (verified against GNOME Shell 50.1)
- GJS 1.88 or newer (verified against GJS 1.88.0)
- Wayland

Only GNOME Shell `50` is declared in `metadata.json`. Compatibility with older GNOME releases is not claimed.

## Install on Ubuntu 26.04.1

No root access is required. From the project directory:

```bash
./install.sh
gnome-extensions enable shadow-panel@shadowokx
```

On Wayland, log out and back in if Shell has not discovered a newly installed extension. GNOME Shell cannot safely be restarted with `Alt+F2`, `r` on Wayland.

When replacing an already loaded development build, log out and back in before enabling the new build. GNOME Shell 50 intentionally keeps extension ES modules in memory for the life of the Shell process, so disable/enable alone is not a source-code reload on Wayland.

Open preferences with:

```bash
gnome-extensions prefs shadow-panel@shadowokx
```

Uninstall only the extension code with:

```bash
./uninstall.sh
```

Uninstalling intentionally preserves user content and caches:

- Quick Notes: `${XDG_DATA_HOME:-~/.local/share}/shadow-panel/notes.json`
- Provider caches: `${XDG_CACHE_HOME:-~/.cache}/shadow-panel/`

## Codex usage source

At refresh time Shadow Panel starts the installed `codex app-server --stdio` executable with a fixed argument vector. It initializes the JSON-lines protocol and calls:

```text
account/read
account/rateLimits/read
```

The account response can provide account type, plan, and email. Shadow Panel retains only the email local part as a short display label; the complete email is neither cached nor logged. The initialize response supplies the client user-agent, from which only a version string is retained.

The rate-limit response supplies structured windows with `usedPercent`, `windowDurationMins`, and `resetsAt`. A roughly 300-minute window is classified as five-hour capacity and a roughly 10,080-minute window as weekly capacity. The UI derives `remainingPercent = 100 - usedPercent`, labels it explicitly as “left,” and uses five-hour remaining capacity in the top bar when present. Weekly remaining is the fallback when the five-hour window is absent.

When reported, the page also shows reset-credit count and Codex client version. Less useful provider metadata stays out of the popup. Missing fields are omitted rather than invented. The provider follows the [official Codex App Server protocol documentation](https://developers.openai.com/codex/app-server/).

Security properties:

- Shadow Panel never reads, stores, displays, prints, or logs OpenAI access tokens.
- Codex uses its own existing signed-in state.
- No shell interprets the Codex executable or arguments.
- Raw app-server messages and stderr are not logged.
- A 15-second timeout cancels and terminates an unresponsive process.
- Successful normalized responses are cached; background refresh defaults to 15 minutes.

## Weather and privacy

The configured location is sent to Open-Meteo geocoding, then the selected coordinates are sent to Open-Meteo forecast. No API key is needed. Requests are asynchronous, time-limited, cached, and made only when stale, manually refreshed, or after relevant settings change.

The hourly forecast is a fixed five-column actor row rather than a horizontal `St.ScrollView`; this removes the scrollbar artifact completely. Forecast labels use the resolved location timezone, and the section heading summarizes the maximum precipitation chance for those hours. The full Weather body only becomes vertically scrollable when text scaling or available height genuinely requires it.

Quick Notes remain in the local XDG data directory unless the user selects Obsidian or “Local Notes and Obsidian” as the capture destination.

## Codex summary images

The Share action renders a 1200×675 PNG using Cairo and Pango. It includes the privacy-reduced account/product label, weekly remaining and used percentages, countdown and absolute reset, five-hour state, reset credits/client version when available, and update state.

Images are written to the configured XDG Pictures directory under `Shadowokx Panel/` (normally `~/Pictures/Shadowokx Panel/`). Rendering and PNG encoding run in a bounded helper process rather than on GNOME Shell's UI thread. The exporter uses a private temporary file followed by a non-overwriting atomic move; repeated names receive a numeric suffix. Shell's text-oriented clipboard interface does not offer a dependable cross-desktop PNG path, so the popup confirms the saved filename and provides an **Open folder** action instead of pretending to copy an image.

## Obsidian integration

Configure Preferences → Integrations → Quick Notes and Obsidian:

1. Choose an existing Obsidian vault with the native folder chooser.
2. Set a relative target such as `Inbox/QuickNotes`.
3. Set a filename pattern. Supported placeholders are `{date}`, `{time}`, and `{timestamp}`.
4. Choose Local Notes, Obsidian, or both for the primary Quick Capture action.

The integration is deliberately narrow:

- It verifies that the selected absolute folder exists and contains `.obsidian`.
- It rejects absolute targets, `..`, backslashes, control characters, and symlinked vault/target components.
- It creates only the configured target folders and one new private UTF-8 Markdown file per save.
- It never overwrites a note; duplicate filenames receive a numeric suffix.
- It does not scan, index, or read unrelated vault files.
- Opening folders and apps uses allowlisted `file:`, `obsidian:`, and `codex:` URIs without a shell.

## Architecture

```text
extension.js                 extension lifecycle, shared services, migration, rebuilds
prefs.js                     native Adwaita preferences
ui/
  panel.js                   top-bar summary, application header, page lifecycle
  tabs.js                    icon-first expanding tabs and overflow scrolling
  components.js              shared accessible St controls and state widgets
icons/                       crisp six-lobe OpenAI-inspired symbolic mark
lib/
  summary.js                 pure remaining/weather/note summary selection
modules/
  codex/                     provider, normalization, weekly-first page, PNG exporter
  weather/                   isolated Open-Meteo provider, normalization, page
  notes/                     local store, guarded Obsidian service, page
services/
  jsonStore.js               bounded, cross-instance serialized atomic JSON replacement
  launcher.js                allowlisted asynchronous URI launching
  scheduler.js               named cancellable GLib timers
  observable.js              structured state subscriptions
  logger.js                  minimal redacted diagnostics
schemas/                     GSettings schema
tests/                       pure normalization, validation, persistence, import tests
```

Providers and stores return structured state and never import page code. Long-lived content services survive appearance-only UI rebuilds, so draft state and note writes are not raced by theme changes. A failed module gets its own recovery page without taking down the popup. Disabled network modules are not started.

## Development

The end-user installer needs only the normal GNOME desktop tools. For the full development checks on Ubuntu 26.04.1, install the validation utilities if they are not already present:

```bash
sudo apt install gjs libglib2.0-bin libxml2-utils unzip ripgrep dbus-daemon
```

The headless runtime check additionally expects the GNOME Shell 50/Mutter 18 runtime already provided by the target desktop.

Run strict schema validation, pure logic/storage/Obsidian tests, Shell-side module imports, and package creation:

```bash
./scripts/check.sh
```

Load the extension in a disposable headless GNOME Shell session without touching the active desktop:

```bash
./scripts/runtime-check.sh
```

Optionally exercise the installed Codex app-server provider and print only non-secret diagnostics:

```bash
XDG_CACHE_HOME=/tmp/shadow-panel-codex-check gjs -m tests/live-codex.mjs
```

Exercise the live Open-Meteo provider with the same isolated-cache approach:

```bash
XDG_CACHE_HOME=/tmp/shadow-panel-weather-check gjs -m tests/live-weather.mjs
```

Build the installable archive:

```bash
./scripts/package.sh
```

The default output is `dist/shadow-panel@shadowokx.shell-extension.zip`.

Show Shadow Panel journal messages:

```bash
./scripts/logs.sh
```

Normal operation is quiet. Enable debug logging only while diagnosing a problem; diagnostic fields are redacted by key name and raw provider payloads are never logged.

## Data integrity

Local note files and caches are size-bounded. Note reads/writes are serialized by absolute path across extension instances and use `Gio.File.replace_contents_async()` with private, replace-destination flags, so the JSON file is atomically replaced. A malformed or oversized note file is left untouched and Notes becomes read-only until the problem is resolved. Obsidian capture and Codex image export both use private temporary files followed by non-overwriting moves. Preferences stay in GSettings.

## Known limitations

- The local Codex app-server is structured and documented, but its schema can evolve with the installed Codex client. The provider is isolated for replacement or adaptation.
- Some accounts or sessions report only weekly capacity. Shadow Panel keeps the five-hour card explicitly unavailable and never fabricates a value.
- The protocol currently provides an email rather than a separate friendly display name; Shadow Panel shows and stores only the email local part.
- The bundled symbolic mark is an original brand-faithful six-lobe glyph, not a redistributed ChatGPT application asset.
- Share saves PNG files and exposes their folder; direct image clipboard transfer is intentionally not claimed because GNOME Shell's stable extension clipboard API is text-oriented.
- Quick Capture is optimized for up to 500 short notes of 2,000 Unicode characters each, not full document editing.
- Obsidian capture creates Markdown notes but intentionally does not browse, search, modify, or synchronize existing vault content.

## Troubleshooting

### Extension is not listed

Run `./install.sh`, then log out and back in. Confirm discovery with:

```bash
gnome-extensions info shadow-panel@shadowokx
```

### Codex usage is unavailable

Confirm the client is installed and signed in:

```bash
codex --version
codex doctor --summary
```

Shadow Panel also checks the Codex binary bundled with the ChatGPT desktop app. It never asks for an API key.

### Weather cannot find a location

Use a city and country, for example `Cairo, Egypt`, then refresh. The last successful forecast remains visible as cached data during temporary network failures.

### Obsidian needs attention

Choose the vault root—not a subfolder—and confirm it contains `.obsidian`. The target folder must be relative to that vault and cannot contain `.` or `..` path segments.

### Inspect warnings

```bash
./scripts/logs.sh
```

If the popup fails to load, disable the extension before editing or reinstalling it:

```bash
gnome-extensions disable shadow-panel@shadowokx
```

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).

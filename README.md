# Shadowokx Panel

Shadowokx Panel is a small GNOME top-bar utility that does two things well: it shows Codex usage limits and useful local weather. It targets Ubuntu 26.04.1 LTS, GNOME Shell 50, Wayland, and modern GJS ES modules.

Release `2.0.1` deliberately contains only two pages:

1. ChatGPT Codex
2. Weather

The popup behaves like a compact GNOME application with a quiet product header, two icon-first tabs, one focused page at a time, neutral surfaces, and clear cached or recovery states.

## Screenshots

Screenshots will be added after the first 2.0 release capture.

- Top bar: `[ChatGPT] 45%   [Weather] 29°`
- Codex selected: `[ ChatGPT Codex ]   ☀`
- Weather selected: `ChatGPT   [ ☀ Weather ]`

The Codex percentage always means **remaining capacity**, never consumed capacity.

## Features

- Compact configurable top-bar fields for the ChatGPT icon, remaining percentage, weekly reset countdown, weather icon, temperature, and condition.
- Two fixed tabs with icon-only inactive state and a subtle icon-plus-label active state. There is no scrolling tab widget or separator artifact.
- A weekly-first Codex hero with dominant remaining capacity, remaining-progress meter, tasteful 🟢/🟡/🟠/🔴 state cues, reset countdown/date, compact five-hour state, reset credits, client version, refresh, Open Codex, and PNG Share actions.
- Verified Codex token activity for today, lifetime total, peak day, and peak-day tokens when the signed-in app-server reports them. Peak hour is shown as unsupported because the provider exposes daily buckets, not hourly timestamps.
- Current-weather hero with condition, location, high/low, up to four optional details, four next-hour forecasts, optional sunrise/sunset, Celsius or Fahrenheit, and location-aware times.
- Cached Codex and Weather data remain visible during temporary failures.
- Auto, Dark, and Light modes; Claude Gray, Graphite, GNOME, and Light Neutral backgrounds; Comfortable and Compact density; seven accent presets plus a custom accent.
- Native Adwaita preferences containing only General, Appearance, Codex, Weather, and About.
- No telemetry or analytics.

## Supported platform

- Ubuntu 26.04.1 LTS
- GNOME Shell 50.x, verified with GNOME Shell 50.1
- GJS 1.88 or newer, verified with GJS 1.88.0
- Wayland

Only GNOME Shell `50` is declared in `metadata.json`.

## Install on Ubuntu 26.04.1

No root access is required. From the project directory:

```bash
./install.sh
```

On Wayland, log out and back in after installing or replacing the extension, then enable it:

```bash
gnome-extensions enable shadow-panel@shadowokx
```

GNOME Shell keeps extension ES modules in memory for the life of the Shell process, so disable/enable alone is not a complete source-code reload on Wayland.

Open preferences with:

```bash
gnome-extensions prefs shadow-panel@shadowokx
```

Uninstall the extension code with:

```bash
./uninstall.sh
```

Provider caches are intentionally preserved under `${XDG_CACHE_HOME:-~/.cache}/shadow-panel/`.

## Codex provider

Shadowokx Panel starts the locally installed `codex app-server --stdio` executable with a fixed argument vector, initializes its JSON-lines protocol, and requests:

```text
account/read
account/usage/read
account/rateLimits/read
```

The rate-limit response supplies structured windows containing `usedPercent`, `windowDurationMins`, and `resetsAt`. A roughly 300-minute window is classified as the five-hour window and a roughly 10,080-minute window as weekly. Remaining capacity is calculated as:

```text
remaining = 100 - usedPercent
```

The top bar prefers weekly remaining capacity because the weekly limit is the primary product signal, with five-hour remaining as a fallback when weekly is not reported.

`account/usage/read` supplies optional account token-activity summaries and daily buckets. The panel validates and displays only reported integer counts and dates. It never estimates a peak hour from daily data or parses private session transcripts as a substitute.

Security properties:

- No rendered Codex interface is scraped.
- No OpenAI credentials are read, stored, displayed, or logged.
- Codex uses its existing signed-in state.
- No shell interprets the executable or arguments.
- Raw app-server messages and stderr are not logged.
- Responses are bounded to 1 MiB and a 15-second timeout terminates an unresponsive helper.
- Account metadata is optional and never blocks a valid rate-limit result.
- Successful normalized data is cached privately and refreshed at a configurable interval.

The integration follows the [official Codex App Server documentation](https://developers.openai.com/codex/app-server/).

## Open Codex

The Open action uses the registered `codex://` desktop handler through `Gio.AppInfo`. It does not execute a shell command. If no handler is available, GNOME displays a compact notification.

## Codex share images

Share renders a 1200×675 PNG with Cairo and Pango in a bounded helper process, outside GNOME Shell's UI thread. It contains the official ChatGPT application icon, weekly remaining and used percentages, reset timing, five-hour availability, and update time.

Images are created privately and saved without overwriting earlier exports under the configured XDG Pictures directory in `Shadowokx/`, normally:

```text
~/Pictures/Shadowokx/
```

A transient GNOME notification confirms the filename and provides an Open Folder action. No green success row is inserted into the popup. Direct image clipboard transfer is not claimed because GNOME Shell's stable extension clipboard interface is text-oriented.

The bundled ChatGPT icon is used only to identify the Codex integration. See [NOTICE.md](NOTICE.md).

## Weather provider and privacy

The configured location is sent to Open-Meteo geocoding. The resolved coordinates are then sent to the Open-Meteo forecast endpoint. No API key is required.

Requests are asynchronous, time-limited, response-size bounded, cached, and made only when stale, manually refreshed, or after a relevant setting changes. A failed refresh never discards the last successful forecast. Full Weather unavailable state is shown only when no valid result has ever been loaded.

The hourly forecast is a fixed four-column actor row. It does not use a horizontal `St.ScrollView`, so no scrollbar or progress-like bar can appear beneath it. The page remains wheel/touch scrollable while its vertical scrollbar chrome is hidden.

## Appearance

The stylesheet uses a small set of logical surface and text classes rather than page-specific color fragments:

- dashboard background
- primary card
- secondary surface
- primary text
- muted text
- accent
- status and recovery feedback

Accent is limited to selected tabs, progress, important usage values, weather emphasis, and active controls. It does not tint the whole popup.

## Architecture

```text
extension.js                 lifecycle, shared providers, rebuild coordination
prefs.js                     five-page native Adwaita preferences
icons/chatgpt.png            unmodified official ChatGPT desktop asset
lib/
  constants.js               release, modules, accent presets
  format.js                  bounded formatting helpers
  moduleConfig.js            initial-page selection
  summary.js                 pure top-bar value selection
modules/
  codex/                     app-server provider, normalization, page, PNG helper
  weather/                   Open-Meteo provider, normalization, page
services/
  jsonStore.js               bounded private atomic JSON cache
  launcher.js                allowlisted asynchronous URI launch
  scheduler.js               named cancellable GLib timers
  observable.js              structured state subscriptions
  logger.js                  minimal recursive redaction
ui/
  panel.js                   top-bar summary and page lifecycle
  tabs.js                    fixed accessible two-page tab strip
  components.js              shared St controls and states
schemas/                     GSettings schema
tests/                       pure logic, provider, share, and import tests
```

Provider code never imports page code. Codex failure cannot break Weather, and Weather failure cannot break Codex. All timers, cancellables, subscriptions, subprocesses, and actors are released when the extension is disabled.

## Development

The complete checks use the standard Ubuntu GNOME runtime plus:

```bash
sudo apt install gjs libglib2.0-bin libxml2-utils unzip ripgrep dbus-daemon
```

Run schema, logic, provider-isolation, import, share-image, and package checks:

```bash
./scripts/check.sh
```

Run an isolated GNOME Shell enable/preferences/rebuild/disable/re-enable check:

```bash
./scripts/runtime-check.sh
```

Exercise the live providers with isolated caches:

```bash
XDG_CACHE_HOME=/tmp/shadow-panel-codex-check gjs -m tests/live-codex.mjs
XDG_CACHE_HOME=/tmp/shadow-panel-weather-check gjs -m tests/live-weather.mjs
```

Build the installable archive:

```bash
./scripts/package.sh
```

Show current-session extension messages:

```bash
./scripts/logs.sh
```

Normal operation is quiet. Debug logging is disabled by default and never includes raw provider payloads or credentials.

## Known limitations

- Some Codex accounts or sessions report only weekly capacity. The five-hour section remains compactly unavailable and no value is invented.
- Token activity can be unavailable for unsupported authentication modes or older Codex versions. App-server currently reports daily buckets, so peak hour remains explicitly unsupported.
- The local Codex app-server schema can evolve with future Codex releases; its provider is isolated so it can be updated without changing the page.
- Share saves PNG files and opens their folder; it does not claim binary clipboard support.
- Weather location entry uses safe text validation rather than a network-backed search chooser.

## Troubleshooting

### Extension is not listed

Run `./install.sh`, then log out and back in. Confirm discovery with:

```bash
gnome-extensions info shadow-panel@shadowokx
```

### Codex usage is unavailable

Confirm that Codex is installed and signed in:

```bash
codex --version
```

Shadowokx Panel also checks the Codex binary bundled with the ChatGPT desktop application. It never requests an API key.

### Weather cannot find a location

Use a city and country such as `Cairo, Egypt`, then refresh. The last successful forecast remains visible during temporary network failures.

### Inspect warnings

```bash
./scripts/logs.sh
```

## License

GPL-3.0-or-later for the extension source. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for the bundled brand asset notice.

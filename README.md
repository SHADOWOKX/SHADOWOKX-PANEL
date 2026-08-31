# Shadowokx Panel

Shadowokx Panel is a small GNOME top-bar utility that does two things well: it shows Codex usage limits and useful local weather. It targets Ubuntu 26.04.1 LTS, GNOME Shell 50, Wayland, and modern GJS ES modules.

Release `2.3.2` deliberately contains only two pages:

1. ChatGPT Codex
2. Weather

The popup behaves like a compact GNOME application with a quiet product header, an equal-width segmented control, one focused page at a time, neutral surfaces, and clear cached or recovery states.

## Screenshots

Repository screenshots have not been captured yet. Before publishing the GitHub release,
capture these five real GNOME Shell views and place them under `docs/screenshots/`:

1. Codex page
2. Weather page
3. One theme/accent example
4. Preferences window
5. Compact top-bar indicators

The Codex percentage always means **remaining capacity**, never consumed capacity.

## Features

- Compact configurable top-bar fields for the ChatGPT icon, remaining percentage, weekly reset countdown, optional real-history usage state, weather icon, temperature, and condition. Weather can be hidden from the top bar independently from the popup.
- A genuinely homogeneous 50/50 Codex/Weather segmented control with centered icon-and-label content, identical geometry, restrained accent and hover states, and keyboard navigation. When Weather is disabled in the popup, the single unnecessary segment is removed entirely.
- A weekly-first Codex hero with dominant remaining capacity, remaining-progress meter, compact status pill, reset countdown/date, compact five-hour state, reset credits, refresh, icon-only Open Codex, and PNG Share actions.
- Verified Codex token activity with compact lifetime and peak totals, full peak date, and a 48-pixel native Cairo line-and-area sparkline only when the signed-in app-server reports at least two real daily buckets. The bounded curve cannot overshoot real points, every reported point is marked, the newest point is emphasized, and locale-aware day labels preserve missing-day spacing. Exact lifetime totals remain available in a tooltip.
- Content-driven current-weather hero with condition, shortened and ellipsized location, high/low, up to five optional details including real UV, up to 12 horizontally scrollable forecast hours, optional hourly rain, sunrise/sunset, Celsius or Fahrenheit, and location-aware times.
- Natural-height pages: each page expands only to its own content height and gains vertical scrolling only when the monitor or text scale cannot fit that content safely.
- Cached Codex and Weather data remain visible during temporary failures.
- Follow System, Dark, and Light modes; Shadow, Graphite, GNOME, Soft Neutral, Midnight, Nord, and AMOLED surfaces; Comfortable and Compact density; Narrow, Standard, and Wide panel widths; eight accent presets plus a native custom-color selector.
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

The optional usage-state icon uses completed daily buckets from the same structured token-activity response. It needs at least four completed days, compares the latest completed day with the mean of the preceding completed days, and deliberately excludes the still-changing current day. At 150% or more of that baseline it shows a small flame; at 50% or less it shows a quiet moon; otherwise it shows a neutral balanced state. The icon is omitted when history is missing, insufficient, or has no non-zero baseline. No pace is guessed from the remaining-limit percentage.

`account/usage/read` supplies optional account token-activity summaries and `dailyUsageBuckets`. Every chart point is the validated `tokens` value for the bucket's reported `startDate`; it is not a lifetime snapshot or an inferred delta. Buckets are deduplicated by date, ordered oldest to newest, restricted to the current seven-day calendar window, and never padded with invented zeroes. The panel never estimates a peak hour from daily data or parses private session transcripts as a substitute.

There is intentionally no lifetime-counter delta calculation: the graph uses the app-server's
reported per-day token value directly. Invalid dates and negative or non-integer values are
discarded, duplicate dates keep the latest valid report, missing dates remain visible as real
calendar gaps, and both live and cached history are bounded to seven actual buckets.

The 48-pixel mini graph is drawn by a native `St.DrawingArea` with Cairo: a subtle rounded accent curve, bounded control points, a restrained gradient area fill, and one highlighted endpoint. Its X positions preserve real calendar gaps and its Y scale keeps a truthful zero baseline. It has no redraw timer or animation loop. With fewer than two real daily buckets the card says “Not enough history yet.” All-zero, duplicate, corrupt, missing-day, single-point, clipping-bound, and large-spike inputs are covered by pure tests.

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

The Weather page and top-bar summary have separate switches. If both are disabled, the Weather provider and its timer are not created at all; Codex-only mode therefore has no hidden Weather polling or placeholder UI.

The hourly forecast keeps up to 12 validated hours in one bounded horizontal `St.ScrollView`. It uses exact four-column pages, so no partial fifth item or scrollbar artifact leaks through the rounded card. Additional pages remain available to touchpad or horizontal-wheel scrolling; the hourly view never creates vertical overflow.

The main page remeasures resolved, styled content after every render and page switch. It compares that natural height with the active monitor's real GNOME work area after dynamically measuring the dashboard header, tabs, page title, padding, and other non-scroll chrome. Vertical policy is `NEVER` when content fits and hidden-chrome `EXTERNAL` only for genuine overflow. Codex and Weather resize independently, switching resets the new page to the top, monitor changes trigger a refit, and text-scale changes rebuild the measured layout.

## Privacy and local data

- Codex limits, reset times, and optional daily token totals are requested from the locally
  installed Codex app-server. Shadowokx Panel does not read or store OpenAI credentials.
- Normalized Codex state and its bounded history are cached in
  `${XDG_CACHE_HOME:-~/.cache}/shadow-panel/codex.json`.
- The configured Weather location is sent to Open-Meteo's geocoding service; the returned
  coordinates are sent to its forecast service. The normalized forecast cache is stored in
  `${XDG_CACHE_HOME:-~/.cache}/shadow-panel/weather.json`.
- Usage summary images are written only when requested, under the configured Pictures directory.
- There is no analytics, telemetry, advertising SDK, or upload of popup contents. Apart from
  the Open-Meteo requests above and the local Codex client's own account-usage operation, the
  extension sends no user data to another service.

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

The custom accent uses GTK 4's native color dialog and stores one validated `#RRGGBB` value in GSettings. Invalid values fall back to Rose. Appearance changes are applied by a debounced indicator rebuild as soon as the popup is closed, avoiding actor replacement while the user is interacting with it. Rebuilds wait for GNOME to release the previous status-area role before mounting a replacement.

## Architecture

```text
extension.js                 lifecycle, shared providers, rebuild coordination
prefs.js                     five-page native Adwaita preferences
icons/chatgpt.png            unmodified official ChatGPT desktop asset
lib/
  constants.js               release, modules, accent presets
  format.js                  bounded formatting helpers
  moduleConfig.js            initial-page selection
  sparkline.js               validated history and pure chart geometry
  summary.js                 pure top-bar value selection
modules/
  codex/                     app-server provider, normalization, page, Cairo chart, PNG helper
  weather/                   Open-Meteo provider, normalization, page
services/
  jsonStore.js               bounded private atomic JSON cache
  launcher.js                allowlisted asynchronous URI launch
  scheduler.js               named cancellable GLib timers
  observable.js              structured state subscriptions
  logger.js                  minimal recursive redaction
ui/
  panel.js                   top-bar summary and page lifecycle
  tabs.js                    equal-width accessible segmented control
  components.js              shared St controls and states
schemas/                     GSettings schema
tests/                       pure logic, provider, share, and import tests
```

Provider code never imports page code. Codex failure cannot break Weather, and Weather failure cannot break Codex. All timers, cancellables, subscriptions, subprocesses, and actors are released when the extension is disabled.

Provider updates mark closed pages dirty without rebuilding their hidden actor trees. The selected page renders the pending state when opened, refresh-start updates only the current button, countdown/relative-time ticks update only their labels, refresh animation runs only while its page is visible, and top-bar-only setting changes update the existing indicator actors without a full panel reconstruction.

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

Open the real popup in an isolated Wayland Shell, switch both pages repeatedly, and validate content allocations:

```bash
./scripts/ui-smoke.sh
SHADOW_UI_DENSITY=compact SHADOW_UI_WIDTH=narrow ./scripts/ui-smoke.sh
SHADOW_UI_HEIGHT=420 SHADOW_EXPECT_SCROLL=true ./scripts/ui-smoke.sh
SHADOW_TEXT_SCALE=1.5 SHADOW_EXPECT_SCROLL=true ./scripts/ui-smoke.sh
SHADOW_UI_THEME=light SHADOW_UI_BACKGROUND=nord SHADOW_UI_ACCENT=blue ./scripts/ui-smoke.sh
SHADOW_SHOW_WEATHER_PANEL=false SHADOW_SHOW_WEATHER_TOP_BAR=false SHADOW_SHOW_USAGE_STATE=true SHADOW_UI_LIFECYCLE=true ./scripts/ui-smoke.sh
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
- Token activity can be unavailable for unsupported authentication modes or older Codex versions. The graph needs two actual buckets, does not interpolate missing dates, and may therefore show fewer than seven points. Peak hour is not displayed because the provider exposes daily buckets, not hourly timestamps.
- The optional usage-state icon needs at least four completed daily buckets. It stays hidden instead of estimating a state when that history is not available.
- GNOME Shell 50 does not expose one dependable extension-facing system-accent API across the targeted Ubuntu environment, so Follow System covers light/dark mode while accent selection remains explicit.
- Intraday burn rate and limit runway are not displayed because the app-server returns daily history and a current rate-limit snapshot, not enough timestamped history to calculate them honestly.
- The local Codex app-server schema can evolve with future Codex releases; its provider is isolated so it can be updated without changing the page.
- Share saves PNG files and opens their folder; it does not claim binary clipboard support.
- Weather location entry uses safe manual text validation rather than automatic geolocation or a network-backed search chooser.

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

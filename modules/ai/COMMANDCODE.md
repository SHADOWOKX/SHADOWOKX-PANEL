# Native Command Code usage · GNOME Shell

Implemented and authenticated against the actual account on **3 October 2026**.
The native provider uses GJS, asynchronous libsoup 3 networking and GNOME Secret
Service. It does not launch the CLI, a PTY, a model prompt or a third-party proxy.
Codex continues using its existing local app-server integration.

## Data source

The user supplied and authorized Command Code's working alpha endpoints and the
[community reference](https://github.com/MAXeaglet/commandcode-usage). These alpha
interfaces are **not a documented stable public API**. All four returned HTTP 200
with the user's authenticated key during native-provider validation:

| Read-only endpoint | Verified fields used |
| --- | --- |
| `/alpha/whoami` | `user.userName`, optional `org.id` |
| `/alpha/billing/credits` | `credits.monthlyCredits`, `purchasedCredits`, `freeCredits`; `windowLimits.fiveHour` / `weekly` with `used`, `cap`, `exceeded`, `resetAt` |
| `/alpha/billing/subscriptions` | `data.planId`, `status`, `currentPeriodStart`, `currentPeriodEnd` |
| `/alpha/usage/summary` | `totalCount`, `totalCredits`, `totalMonthlyCredits`, `totalPurchasedCredits`, `totalFreeCredits`, `periodBasis` |

Requests go directly to `https://api.commandcode.ai`, using GET, Bearer
Authorization, `Accept: application/json`, and `User-Agent: commandcode-usage/1.0`.
The origin and route allowlist are fixed; redirects are disabled so credentials
cannot follow a redirect to another host. Only the subscriptions query can contain
an encoded organization ID. No credential files, CLI auth tokens, browser cookies,
private CLI helpers or inference endpoints are accessed.

The real responses had a root `credits` / `windowLimits` object, wrapped subscription
`data`, and a root usage summary with `periodBasis: billing-period`. Subscription
dates were ISO strings; window resets were epoch milliseconds. The parser supports
those verified shapes and the reference's documented wrappers/snake-case date fields.
Unknown/malformed fields remain unavailable rather than being guessed or defaulted
to zero. Account IDs/email and unrelated response fields are discarded.

## Supported display

- GOAT is identified from the returned `individual-goat` plan ID; other IDs remain
  their returned IDs. Subscription status comes from the subscription response.
- Monthly credits consumed come directly from `totalMonthlyCredits`; request count
  comes directly from `totalCount`, with the returned usage-period basis displayed.
- Monthly credits remaining, purchased credits and free credits are displayed
  separately. They are credit units, not a fabricated dollar balance.
- Five-hour and weekly utilization is calculated only from the server's `used` and
  `cap`. Raw consumed/cap values, the explicit `exceeded` flag and actual reset
  countdowns are shown. Missing/zero caps never imply 100% remaining.
- Subscription period start/end is displayed. Period end is not an invented reset
  timestamp or a guarantee that a canceled subscription will renew.
- Last successful refresh is shown with its local timestamp and age. On failures,
  retained data is marked **Stale**; expired windows are hidden. Authentication
  failures clear live data. The top bar hides stale Command Code percentages.

**Monthly allowance cap and percentage remain Unavailable:** the actual API did
not return a monthly cap. Unlike the community reference, this integration does
not estimate a cap from a plan table. The balance and summary can also update at
different times; adding consumed and remaining would not establish an authoritative
allowance. Published GOAT limits remain in Settings and in the unavailable/JSON
view, separate from live usage; they never feed native consumption calculations. Spending/model-specific quotas are not
invented from token counts or credit balances.

The live page reuses Codex's existing layout classes, typography, card padding,
remaining-percentage color scale, status pills and progress meter without modifying
Codex code or shared styling. Weekly allowance is the main card; the five-hour
window is a compact row. Real monthly consumption, requests and credit balances
use compact account rows. Percentages are rounded for display with exact values
in tooltips. Dollar estimates, plan-price cards and unsupported history heatmaps
are omitted from the live view. Last refresh and errors remain available in the
footer/status tooltips.

## Secure setup

1. Open Settings → AI providers → Command Code.
2. Paste your account API key into the masked field and press its apply arrow.
3. The connection verifies read-only responses before saving the key in GNOME
   Secret Service under the extension's own schema and attributes.
4. Use **Check connection**, the panel refresh button or **Forget key** as needed.

The key is never stored in GSettings, JSON files, logs, diagnostics, fixtures or
release archives. There is no plaintext fallback. Background lookups do not request
keyring unlocking; a locked/unavailable keyring gives a clear state. Only explicit
saving/removal can invoke the keyring's normal user-facing prompts. The password
field is cleared as soon as submission starts. Removing the provider from the
panel preserves its stored key; **Forget key** explicitly deletes it.

Requires the libsecret introspection package (`gir1.2-secret-1` on Ubuntu) and a
running Secret Service/keyring. Its import is lazy so a missing libsecret does not
break other providers. No extra Node/Python runtime or CLI installation is needed
for native tracking. Re-enter a key in Settings rather than putting it in chat or
extracting CLI credentials.

## Refresh and errors

Polling runs every **180 seconds**, with coalesced concurrent requests, a manual
refresh button and no extra requests on frequent popup opens. Manual refresh
restarts the polling interval. Identity is cached in memory for 15 minutes and
revalidated after key changes; credit/subscription/summary data refreshes each cycle.
Unsupported optional endpoints are not repeatedly probed for 15 minutes.

Each request has a 15-second network timeout and a 1 MiB response limit. Invalid
JSON, changed structures, network/server errors and expired credentials produce
fixed local messages; remote error bodies are never shown. HTTP 401/403 stops
remaining requests. HTTP 429 honors Retry-After seconds or HTTP dates, including
manual refresh; remaining requests stop until the deadline. Optional endpoint
failures retain only freshly returned fields and display a **Partial** indicator.
Shutdown/settings changes cancel pending work and close streams/sessions. Restarts
read the secure key again and obtain a new snapshot rather than inventing cached
current quotas.

## Existing integrations and validation

Existing Command Code JSON files remain available as an explicitly labeled advanced
source. Choosing one switches that provider to JSON mode; reconnecting the secure
API switches it back without deleting the file. CLI **Check login** and **Open
CommandCode Usage** remain available. Other providers, settings, themes and Codex
monitoring retain their existing paths.

`npm test` includes native API parsing, fixed errors/privacy, header/method/route
checks, missing/zero/expired data, retries/rate limits, caching, coalescing, partial
responses, three-minute scheduling, manual refresh, staleness, authentication
failures, locked-keyring behavior, teardown and top-bar reset units. The fixture
contains selected numeric fields from an actual authenticated response; account
identity is redacted and no credentials are present. Tests never contact an AI API.

For explicit authenticated validation after securely connecting:

```sh
gjs -m scripts/verify-commandcode.mjs
```

This exercises the actual native AIProvider and noninteractive Secret Service
lookup. It prints only safe field structure and normalized usage, omitting keys,
raw responses, account IDs, email and usernames. It is not part of offline tests.
The development connection window uses the exact Settings widgets:
`glib-compile-schemas schemas`, then `gjs -m scripts/commandcode-connect.mjs`.
The earlier PTY prototype remains an isolated research artifact; it is not used
by the native provider or included in the extension package.

`gjs -m scripts/verify-commandcode.mjs --poll` additionally waits for one actual
three-minute Scheduler refresh, reports its success/time, and tears down the
provider, timers and session. It makes read-only account requests only.

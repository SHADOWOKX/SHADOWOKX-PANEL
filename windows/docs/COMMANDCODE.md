# Command Code account tracking (Windows)

Last updated: 6 October 2026.

Windows matches the current Linux Command Code integration: native live account
usage read with direct asynchronous read-only requests, plus a deterministic
task-lifecycle observer that drives the mascot only while a real turn is running.

## Native live usage

The panel already knew how to read a usage JSON file. Recent Linux work added a
native provider that talks to Command Code's account endpoints with a user-supplied
API key. Windows now uses the same data and formatting rules.

| Read-only endpoint | Fields used |
| --- | --- |
| `/alpha/whoami` | `user.userName`, optional `org.id` |
| `/alpha/billing/credits` | `credits.monthlyCredits`, `purchasedCredits`, `freeCredits`; `windowLimits.fiveHour` / `weekly` with `used`, `cap`, `exceeded`, `resetAt` |
| `/alpha/billing/subscriptions` | `planId`, `status`, `currentPeriodStart`, `currentPeriodEnd` |
| `/alpha/usage/summary` | `totalCount`, `totalCredits`, `totalMonthlyCredits`, `totalPurchasedCredits`, `totalFreeCredits`, `periodBasis` |

Requests go to `https://api.commandcode.ai` using GET, `Authorization: Bearer`,
`Accept: application/json` and `User-Agent: commandcode-usage/1.0`. The origin and
route allowlist are fixed and redirects are disabled so credentials cannot follow a
redirect to another host. Only `/alpha/billing/subscriptions` may carry an encoded
organization id. Each request has a 15-second deadline and a 1 MiB response limit.

Displayed: weekly allowance, remaining percentage, consumed/limit, requests for the
reported period, the account billing period, the reset countdown, the five-hour
window, the total consumed credits, monthly credits remaining, purchased credits,
free credits, the billing-period end, and the last successful refresh. Missing or
changed fields stay **Unavailable** rather than being guessed or defaulted to zero.
A monthly percentage stays unavailable because the verified API returns no monthly
cap. Published GOAT limits remain separate reference data and never feed live values.

Refreshes run every **three minutes**, with a manual refresh and no extra request on
popup opens. The last known values are marked **Stale** on failure. Authentication,
keyring and unsupported-response errors clear live data. The top bar hides stale
Command Code percentages.

## Secure setup

In **Settings → AI providers → Command Code**, paste the account API key into the
masked field and press **Apply key**. The key is validated against live read-only
requests, then stored only in **Windows Credential Manager** under the panel's own
target name. It is never written to `settings.json`, JSON files, logs, diagnostics
or fixtures, and there is no plaintext fallback. **Check connection** re-reads it;
**Forget key** deletes it. Removing the provider from the panel preserves the key.

Existing usage JSON files remain an explicitly labeled advanced source. Choosing one
switches the provider to JSON mode; reconnecting the API switches it back without
deleting the file. **Check login** still verifies the CLI login separately, and
**Open CommandCode Usage** opens the public browser page.

## Real task behavior (mascot)

Application presence is **not** a task. The observer watches the one deterministic
in-flight signal the Command Code Desktop app writes about itself. It is the same
electron-log file used on Linux, resolved from Electron's `app.getPath("logs")`:

```text
%APPDATA%\Command Code\logs\main.log
```

Verified line format (electron-log, written by the app's own `trace()`):

```text
[2026-10-06 13:09:44.239] [info]  [send] turn running {"sessionId":"...","chars":14065,"images":0}
[2026-10-06 13:09:44.239] [info]  [send] turn resolved {"sessionId":"...","stopReason":"end_turn","pendingSteers":[]}
```

The desktop main process emits these around `instance.runTurn()`, so one user turn
(including every tool call in its agent loop) is one start/end pair. `stop_Reason`
values `end_turn`, `interrupted` and `run_error` all end the turn. There is no
token-level logging, so BUSY never flickers.

- Command Code closed → mascot static
- Command Code open but idle → mascot static
- real turn running → mascot animates
- turn resolved/cancelled/failed → mascot static
- a turn that never logs a terminal line expires after 45 minutes, and a log
  truncation/rotation or an application close clears it immediately

The mascot animates while **either** a real Codex task **or** a real Command Code
turn is running (`mascotBusy = codexTaskBusy || commandCodeTaskBusy`). Application
presence, process existence, CPU/RAM and focus never animate it.

## Windows identity

Classification uses exact tokens and specific paths only — a loose substring such as
`cmd` must never map to an unrelated process. On Windows the packaged desktop
application is `Command Code.exe` (product `Command Code`, package
`@commandcode/desktop`):

- desktop main — the `Command Code.exe` binary without an Electron helper role
- desktop helper — the same binary with `--type=zygote|gpu-process|renderer|utility|broker`
- CLI — only with a strong npm signature (`command-code` / `@commandcode/desktop`
  package path, e.g. `node ...\command-code\dist\cli.mjs`)

Electron helper processes never independently count as activity. `cmd.exe` is the
Windows command shell and is never classified as Command Code; bare `cmd`/`cmdc`
launchers require the strong npm path before they count. Presence is still only
presence: it clears tracked turns when the app closes and never animates the mascot.

## Validation

- `dotnet test windows/tests/ShadowokxPanel.Core.Tests` (runs on any OS): usage
  parsing, fixed errors and privacy, header/route/redirect checks, missing/zero/
  expired data, rate limits, coalescing, partial responses, key scrubbing, the turn
  log observer, identity classification and progress-fill ratios.
- The native WinUI application and the Windows Credential Manager call cannot be
  compiled or executed on Linux. Build with `windows/scripts/build.ps1` and complete
  `windows/docs/RELEASE-QA.md` on a real Windows 11 account, including the
  Command Code open/busy/idle/cancel/fail scenarios, before publishing.

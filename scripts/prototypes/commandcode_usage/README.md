# CommandCode `/usage` PTY investigation

This is an **opt-in Linux experiment**, not the panel's automatic data source.
The production Windows and Linux panels retain **Unavailable** for live account
consumption and keep the usage-page action, documented GOAT reference card and
existing configured JSON integrations. This prototype is not included in the
GNOME extension archive and its output is intentionally not a panel usage export.

## Official interface findings — 3 October 2026

- [CLI reference](https://commandcode.ai/docs/reference/cli) documents
  `status --json` for login status, not account allowance.
- [Slash commands](https://commandcode.ai/docs/reference/slash-commands) documents
  the interactive `/usage` account view.
- [Headless mode](https://commandcode.ai/docs/headless) limits slash commands to
  interactive sessions. Its JSON `usage` is inference-run token usage. Do not
  run `cmd -p /usage`: that is not a documented account-usage interface.
- [Mods](https://commandcode.ai/docs/mods) execute local JavaScript and can add
  commands. No reviewed documentation establishes a machine-readable subscription
  usage export or a per-session switch that disables every user Mod.

No supported machine-readable account interface was found. This does not mean
the CLI cannot retrieve account usage internally. The experiment lets the CLI
itself authenticate and render its own view; it does not import private helpers,
directly call internal endpoints, read credential files or extract tokens.

## Running deliberately

Use a separate virtual environment; no production dependencies change:

```sh
python3 -m venv /tmp/commandcode-usage-venv
/tmp/commandcode-usage-venv/bin/pip install -r scripts/prototypes/commandcode_usage/requirements.txt
/tmp/commandcode-usage-venv/bin/python scripts/prototypes/commandcode_usage/probe.py
```

Normal CLI browser login must already work. The experiment uses the CLI's existing
credential resolution, including its inherited environment. It never requests
keys. Python, Node and the npm-installed CLI must be on PATH. It verifies package
name/version **1.74.0** and SHA-256 of both reviewed `dist/index.mjs` and
`dist/cli.mjs` before starting. Other versions/builds/install layouts fail closed;
updating a pin requires another source and live-behavior review, not just changing
the version string. Automatic CLI updates are disabled for this run.

`--watch` captures every five minutes, measured from capture start. Each capture
gets a new temporary working directory and PTY; there is no resumed conversation.
Ctrl+C/SIGTERM stops and reaps the child. The process group is terminated on every
success/failure, escalated to SIGKILL after three seconds, and waited for. Linux
parent-death signaling kills the Node child if its supervisor dies abruptly.
Subprocess/worker creation is blocked by the instrumentation. Windows returns
`platform-unvalidated` before launching anything: no ordinary-pipe fallback or
untested ConPTY transport is presented as working.

The CLI may initialize its own local project metadata for the temporary working
directory; account network access is read-only under the reviewed transport.
`--no-session` prevents conversation persistence. This is not a claim that CLI
startup performs no local filesystem writes. Existing settings/login files are
not changed by the experiment.

## Capturing and parsing

The CLI is launched interactively with a PTY, no initial message and no print-mode
flag. After the reviewed version banner and settled request counters, the only
command input is `/usage`, followed separately by Enter after 300 ms. Only terminal
cursor-status queries get additional responses. Onboarding, trust, login and tool
prompts are never answered; an unexpected interaction expires after 40 seconds.
The temporary directory alone is auto-trusted. No repository workspace is trusted
or loaded. Skills and session saving are disabled for this invocation.

`pyte` emulates ANSI cursor movement, redraws, colors and fragmented UTF-8. Parsing
requires exactly one complete supported plan/percentage/request/window view,
plus its completion footer. Changed/missing/duplicate fields and invalid metrics
fail closed. Raw terminal output, account-specific usage URLs, remote error text
and credentials are neither printed nor saved. Memory and output are bounded.
The sole temporary report is mode 0600 and contains integer counters only; updates
are atomic and the temporary directory is deleted after the child exits.

The Node preload blocks non-GET fetch/HTTP requests, redirects, WebSockets,
subprocesses and workers. It counts unsuccessful reads and JSON decoding failures.
Any failed read or inference attempt rejects the entire capture, even if the CLI
renders default zero values after a partial error. The reviewed CLI account client
uses global fetch for its GET reads; inference uses POST. The guard never logs
request URLs, bodies, headers or response contents. Instrumentation is verified
with mocked transports, not billable requests.

## Observed account values and limits of the evidence

Repeated authenticated Linux captures, including 140- and 80-column PTYs, returned
GOAT active, **1% monthly usage**, **298 requests this month**, **31 days to renew**,
**0% five-hour usage**, **2% weekly usage**. The weekly reset display moved from
`6d 14h` to `6d 13h` as time elapsed. Once startup settled, opening `/usage` added
four successful GET reads, zero failed reads and zero inference attempts. All
attempted background network writes and child launches were blocked. The monthly
request count stayed 298. Source inspection and instrumented behavior establish
that these observed captures did not send an inference request; the request count
alone would not prove that. Provider-side billing has not been independently audited.

The CLI rounds percentages, and its monthly meter can combine credit pools. These
are **CLI-reported display values**, not exact remaining subscription credits.
Relative reset/renewal text is retained at capture time. No absolute reset instant,
decrementing countdown, remaining-message estimate, spending or model quota is
derived. Unsupported fields remain absent. Each success includes `capturedAt` and
`lastSuccessfulRefresh`; a failure exports Unavailable with only the last success
time, never the old usage values presented as fresh.

## Why automatic panel usage remains disabled

The Linux experiment proves this particular reviewed CLI/account can display the
requested metrics without inference. It does **not** yet establish a safe, reliable
cross-platform production adapter. Windows ConPTY has not been exercised on a
Windows host. The Node preload is instrumentation for known transports, not an OS
network sandbox: arbitrary user Mods could use another transport or modify globals.
Pinning the CLI bundle does not pin installed Mods. A stable documented export,
or a separately validated process-level read-only boundary and Windows PTY adapter,
is needed before silently launching authenticated CLI sessions in the panel every
five minutes. No user Mods/settings were disabled to make the test appear successful.

## Offline tests

```sh
/tmp/commandcode-usage-venv/bin/python tests/commandcode-pty.py
```

Tests cover strict metrics, missing/changed/duplicate fields, relative timers,
ANSI redraws and fragmented UTF-8, build/version rejection, Windows fail-closed
behavior, safe counters, blocked writes/inference/workers, read/JSON failures,
five-minute scheduling and last-success retention, fake-CLI PTY input, deadlines,
authentication failure, cancellation and child reaping. They never start the
installed CLI, access credentials, contact CommandCode or invoke a model. `npm test`
also runs these tests; terminal tests are explicitly skipped if the pinned optional
prototype dependencies are unavailable. Full terminal tests were run here on Linux.

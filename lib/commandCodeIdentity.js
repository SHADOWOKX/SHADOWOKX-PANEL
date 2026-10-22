// Canonical Command Code identity. Exact tokens and specific paths only:
// a loose substring such as "cmd" must never classify an unrelated process.
//
// Verified on a real installation (5 October 2026):
//   desktop file: /usr/share/applications/command-code.desktop
//   GNOME app id / StartupWMClass: command-code
//   main executable:  /opt/Command Code/command-code   (Electron, no --type)
//   Electron bundle:  --app-path=/opt/Command Code/resources/app
//   Electron data:    --user-data-dir=/home/<user>/.config/Command Code
//   helpers:          same binary with --type=zygote|gpu-process|renderer|utility|broker
//   CLI (npm):        command-code package => .../command-code/dist/cli.mjs, bin cmd/cmdc
//
// The desktop app quits on window close (no tray): window-all-closed -> app.quit().

const normalize = value => String(value ?? '').trim().toLowerCase();
const basename = value => String(value ?? '').split('/').pop() ?? '';

// Exact application / desktop / window identifiers.
const COMMAND_CODE_APP_IDS = new Set([
    'command-code',
    'commandcode',
    'command code',
    'com.commandcode.app',
    '@commandcode/desktop',
]);

// Exact basenames of the user-facing desktop binary only. Deliberately excludes
// the CLI bins (cmd/cmdc) and every "-desktop" wildcard.
const COMMAND_CODE_DESKTOP_BINARIES = new Set([
    'command-code',
    'commandcode',
]);

// npm package directory for the CLI, e.g. /usr/lib/node_modules/command-code/...
const COMMAND_CODE_PACKAGE_PATH = /(^|\/)(command-code|@commandcode\/desktop)(\/|$)/i;
// Electron bundle argument, e.g. --app-path=/opt/Command Code/resources/app
const COMMAND_CODE_APP_PATH = /(^|\/)command[ _-]?code\/resources\/app(\/|$)/i;
// Electron data directory, e.g. --user-data-dir=/home/<user>/.config/Command Code
const COMMAND_CODE_USER_DATA = /--user-data-dir=.*(^|\/)command[ _-]?code(\/|$)/i;
// Electron helper role, e.g. --type=renderer. Works for NUL-separated argv
// and for the space-joined cmdline Electron writes on helper processes.
const ELECTRON_HELPER_ROLE = /(^|[\s\0])--type=/;

// Generic Electron/Chromium hosts. Used only to decide whether a process's
// command line is worth inspecting; they never map to a provider by themselves.
const GENERIC_DESKTOP_HOSTS = /^(electron|electron\d*|chrome|google-chrome|google-chrome-stable|google-chrome-beta|chromium|chromium-browser|brave|brave-browser|msedge|microsoft-edge|chromedriver)$/;

export function isGenericDesktopHost(name) {
    return GENERIC_DESKTOP_HOSTS.test(normalize(name));
}

// One canonical rule set for every identifier path: CLI, Desktop and the
// Electron process hierarchy (main + helper processes).
export function isCommandCodeApplication({appId = '', desktopId = '', wmClass = '', executable = '', argv = []} = {}) {
    for (const identifier of [appId, desktopId, wmClass]) {
        const value = normalize(identifier).replace(/\.desktop$/, '');
        if (COMMAND_CODE_APP_IDS.has(value)) return true;
    }
    const exe = String(executable ?? '');
    if (COMMAND_CODE_DESKTOP_BINARIES.has(normalize(basename(exe)))) return true;
    if (COMMAND_CODE_PACKAGE_PATH.test(exe) || COMMAND_CODE_APP_PATH.test(exe)) return true;
    const args = Array.isArray(argv) ? argv.map(argument => String(argument ?? '')) : [];
    if (args.length && COMMAND_CODE_DESKTOP_BINARIES.has(normalize(basename(args[0])))) return true;
    for (const argument of args) {
        if (COMMAND_CODE_APP_PATH.test(argument) || COMMAND_CODE_USER_DATA.test(argument) ||
            COMMAND_CODE_PACKAGE_PATH.test(argument))
            return true;
    }
    return false;
}

// Classify a single process. Returns:
//   'desktop-main'   the user-facing desktop process (no Electron helper role)
//   'desktop-helper' an Electron zygote/gpu/renderer/utility/broker process
//   'cli'            the Command Code CLI (strong npm signature only)
//   null             not Command Code
export function commandCodeProcessRole({comm = '', executable = '', argv = []} = {}) {
    const name = normalize(comm);
    const exe = String(executable ?? '');
    const base = normalize(basename(exe)) || name;
    const args = Array.isArray(argv) ? argv.map(argument => String(argument ?? '')) : [];
    const raw = args.join('\0');
    const helperRole = ELECTRON_HELPER_ROLE.test(raw);
    const strongPackage = COMMAND_CODE_PACKAGE_PATH.test(exe) || COMMAND_CODE_PACKAGE_PATH.test(raw);

    if (COMMAND_CODE_DESKTOP_BINARIES.has(base))
        return helperRole ? 'desktop-helper' : 'desktop-main';

    if (isGenericDesktopHost(name)) {
        if (COMMAND_CODE_APP_PATH.test(raw) || COMMAND_CODE_USER_DATA.test(raw))
            return helperRole ? 'desktop-helper' : 'desktop-main';
        return null;
    }

    // cmd / cmdc are far too generic to match by name. They only count as the
    // CLI when the resolved executable or argv proves the npm installation.
    if (name === 'cmd' || name === 'cmdc')
        return strongPackage ? 'cli' : null;

    if (/^(node|bun|python3?)$/.test(name))
        return strongPackage ? 'cli' : null;

    return null;
}

// True when a process looks Command Code related but was not classified.
// Only used for diagnostics, with a specific "command[ -]?code" token.
export function isCommandCodeCandidate({executable = '', argv = []} = {}) {
    const args = Array.isArray(argv) ? argv : [];
    return /command[ _-]?code/i.test([basename(executable), ...args].join(' '));
}

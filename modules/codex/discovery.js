import GLib from 'gi://GLib';

const SYSTEM_CANDIDATES = Object.freeze([
    '/usr/lib/chatgpt/resources/codex',
    '/usr/lib64/chatgpt/resources/codex',
    '/opt/chatgpt/resources/codex',
    '/usr/local/bin/codex',
    '/usr/bin/codex',
    '/snap/bin/codex',
]);

function child(root, ...parts) {
    return typeof root === 'string' && GLib.path_is_absolute(root)
        ? GLib.build_filenamev([root, ...parts])
        : null;
}

function environmentValue(environment, name) {
    if (environment !== undefined)
        return Object.hasOwn(environment, name) ? environment[name] : null;
    return GLib.getenv(name);
}

export function codexExecutableCandidates(options = {}) {
    const home = options.homeDirectory ?? GLib.get_home_dir();
    const data = options.userDataDirectory ?? GLib.get_user_data_dir();
    const environment = options.environment;
    const candidates = [
        child(home, '.local', 'bin', 'codex'),
        child(home, 'bin', 'codex'),
        child(home, '.npm-global', 'bin', 'codex'),
        child(home, '.npm', 'bin', 'codex'),
        child(home, '.volta', 'bin', 'codex'),
        child(home, '.bun', 'bin', 'codex'),
        child(home, '.asdf', 'shims', 'codex'),
        child(data, 'pnpm', 'codex'),
        child(data, 'mise', 'shims', 'codex'),
        child(environmentValue(environment, 'NVM_BIN'), 'codex'),
        child(environmentValue(environment, 'VOLTA_HOME'), 'bin', 'codex'),
        child(environmentValue(environment, 'BUN_INSTALL'), 'bin', 'codex'),
        child(environmentValue(environment, 'PNPM_HOME'), 'codex'),
        child(environmentValue(environment, 'FNM_MULTISHELL_PATH'), 'bin', 'codex'),
        ...SYSTEM_CANDIDATES,
    ];
    return [...new Set(candidates.filter(Boolean))];
}

export function findCodexExecutable(options = {}) {
    const pathLookup = options.pathLookup ?? GLib.find_program_in_path;
    const executableTest = options.executableTest ?? (path =>
        GLib.file_test(path, GLib.FileTest.IS_REGULAR) &&
        GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE));
    const fromPath = pathLookup('codex');
    for (const path of [fromPath, ...codexExecutableCandidates(options)]) {
        if (path && executableTest(path))
            return path;
    }
    return null;
}

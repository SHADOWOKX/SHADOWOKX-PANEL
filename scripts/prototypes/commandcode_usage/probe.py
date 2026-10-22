"""Opt-in investigation only. Never imported/launched by the production panel.

Capture the reviewed CLI's own /usage view, not its private API or auth files.
No raw terminal output, account URL or credential field leaves this module.
"""
import argparse
import codecs
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

VERSION = '1.74.0'
HASHES = {
    'cli.mjs': '9fcecaa20d88d0fe0a47e94541cb9eca99351c274f9db01fcf9fac8bf97f0ac0',
    'index.mjs': '157feefa0140e78f060ef2c1f9c50d10de702196ea229dc73db6bbcc39a0bcbb',
}
INTERVAL = 300
COUNTERS = ('get', 'blockedWrites', 'blockedChildren', 'failedReads', 'blockedInference')
BAR = r'[\s█▓▒░▏▎▍▌▋▊▉━─]*'
DURATION = r'(?:[1-9]\d*d(?: [1-9]\d?h)?|[1-9]\d*h(?: [1-9]\d?m)?|[1-9]\d*m)'


class Unavailable(Exception):
    """Only fixed, locally authored diagnostic codes are exported."""


def parse_screen(text):
    """Parse an emulated final screen, never concatenated ANSI output/history.

    Percentages and relative timers are rounded CLI display values. No conversion
    to remaining credits, exact reset instants or spending is made.
    """
    if len(text) > 65536:
        raise Unavailable('output-limit')
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    def one(pattern):
        matches = [match for line in lines if (match := re.fullmatch(pattern, line))]
        if len(matches) != 1:
            raise Unavailable('unsupported-screen')
        return matches[0]
    if 'Press Esc to close' not in lines or 'Usage limits' not in lines:
        raise Unavailable('incomplete-screen')
    if any(word in text.lower() for word in ('not authenticated', 'session expired', 'network error', 'unable to', 'error:')):
        raise Unavailable('cli-error')
    plan = one(r'USAGE\s+(GOAT|Go|Pro|Max(?: \d+)?) Plan · (active)')
    monthly = one(BAR + r'(\d{1,3})% used')
    requests = one(r'(\d{1,12}) requests this month · (\d{1,3}) days? to renew')
    windows = []
    for name in ('5-hour', 'Weekly'):
        window = one(re.escape(name) + r' ' + BAR + r'(\d{1,3})%(?: · resets in (' + DURATION + r'))?')
        percentage = int(window[1])
        if not 0 <= percentage <= 100:
            raise Unavailable('invalid-percent')
        windows.append({'label': name, 'usedPercent': percentage, 'resetDisplay': window[2]})
    if not 0 <= int(monthly[1]) <= 100 or int(requests[2]) > 366:
        raise Unavailable('invalid-metric')
    return {'source': 'experimental-cli-display', 'cliVersion': VERSION, 'plan': plan[1],
            'planStatus': plan[2], 'monthlyUsedPercent': int(monthly[1]),
            'requestsThisMonth': int(requests[1]), 'renewalDisplay': f'{requests[2]} days to renew',
            'windows': windows}


def counters(path):
    try:
        value = json.loads(path.read_text())
        if set(value) != set(COUNTERS) or any(type(value[k]) is not int or value[k] < 0 for k in COUNTERS):
            raise ValueError()
        return value
    except (OSError, ValueError):
        raise Unavailable('instrumentation-failed') from None


def reviewed_entry():
    binary = next((shutil.which(name) for name in ('cmdc', 'commandcode', 'cmd') if shutil.which(name)), None)
    if not binary:
        raise Unavailable('cli-missing')
    entry = Path(binary).resolve()
    try:
        package = json.loads((entry.parent.parent / 'package.json').read_text())
        if package.get('name') != 'command-code' or package.get('version') != VERSION:
            raise Unavailable('unreviewed-cli-version')
        for name, expected in HASHES.items():
            if hashlib.sha256((entry.parent / name).read_bytes()).hexdigest() != expected:
                raise Unavailable('unreviewed-cli-build')
        if entry.name != 'index.mjs':
            raise Unavailable('unsupported-installation')
    except (OSError, ValueError):
        raise Unavailable('unsupported-installation') from None
    node = shutil.which('node')
    if not node:
        raise Unavailable('node-missing')
    return node, str(entry)


def child_setup(expected_parent):
    # SIGKILL the Node child if the supervising Python process dies on Linux.
    # Together with blocked child/worker launches this prevents orphan CLI jobs.
    if ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGKILL, 0, 0, 0) != 0:
        os._exit(125)
    if os.getppid() != expected_parent:
        os._exit(125)


def capture(argv, cwd, report, *, timeout=40, width=140, height=60):
    # No unvalidated ConPTY emulation or ordinary pipes on Windows.
    if sys.platform != 'linux':
        raise Unavailable('platform-unvalidated')
    try:
        import pyte
    except ImportError:
        raise Unavailable('terminal-emulator-missing') from None
    import fcntl
    import pty
    import struct
    import termios
    master, slave = pty.openpty()
    process = None
    before = None
    stats = None
    sent = False
    enter_at = None
    size = 0
    start = time.monotonic()
    previous_stats = None
    quiet_since = start
    last_output = start
    screen = pyte.Screen(width, height)
    stream = pyte.Stream(screen)
    decoder = codecs.getincrementaldecoder('utf-8')('replace')
    env = dict(os.environ, TERM='xterm-256color', COMMANDCODE_PROBE_REPORT=str(report))
    env.pop('NODE_OPTIONS', None)
    try:
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', height, width, 0, 0))
        parent = os.getpid()
        process = subprocess.Popen(argv, stdin=slave, stdout=slave, stderr=slave, cwd=cwd,
                                   env=env, start_new_session=True, preexec_fn=lambda: child_setup(parent))
        os.close(slave)
        slave = None
        while time.monotonic() - start < timeout:
            now = time.monotonic()
            if select.select([master], [], [], 0.1)[0]:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    raise Unavailable('cli-exited') from None
                if not data:
                    raise Unavailable('cli-exited')
                last_output = now
                size += len(data)
                if size > 1048576:
                    raise Unavailable('output-limit')
                # Terminal queries only; never respond to onboarding/login/tool prompts.
                if b'\x1b[6n' in data:
                    os.write(master, b'\x1b[1;1R')
                stream.feed(decoder.decode(data))
            text = '\n'.join(screen.display)
            if any(word in text.lower() for word in ('not authenticated', 'session expired', 'sign in to', 'please log in')):
                raise Unavailable('authentication-required')
            if not report.exists() and now - start < 5:
                continue
            stats = counters(report)
            if stats != previous_stats:
                previous_stats = stats
                quiet_since = now
            if stats['failedReads']:
                raise Unavailable('read-failed')
            if stats['blockedInference']:
                raise Unavailable('inference-attempt-blocked')
            # Require the reviewed version banner and settled startup. Never retry
            # an input command after sending it; a changed view simply times out.
            if not sent and f'Command Code v{VERSION}' in text and now - start >= 5 and now - quiet_since >= 1:
                before = dict(stats)
                os.write(master, b'/usage')
                enter_at = now + 0.3
                sent = True
            if enter_at is not None and now >= enter_at:
                os.write(master, b'\r')
                enter_at = None
            if sent and enter_at is None and 'Full breakdown at' in text and 'Press Esc to close' in text and now - last_output >= 0.5:
                result = parse_screen(text)
                if stats['get'] - before['get'] < 4:
                    raise Unavailable('incomplete-reads')
                result['capturedAt'] = datetime.now(timezone.utc).isoformat()
                result['guardBefore'] = before
                result['guardAfter'] = dict(stats)
                return result
        raise Unavailable('timeout')
    finally:
        if process:
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            except ProcessLookupError:
                process.wait()
        os.close(master)
        if slave is not None:
            os.close(slave)


def probe(timeout=40, width=140):
    if sys.platform != 'linux':
        raise Unavailable('platform-unvalidated')
    node, entry = reviewed_entry()
    with tempfile.TemporaryDirectory(prefix='commandcode-usage-probe-') as directory:
        report = Path(directory) / 'counts.json'
        guard = Path(__file__).with_name('readonly.cjs').resolve()
        return capture([node, '--require', str(guard), entry, '--no-auto-update',
                        '--skip-onboarding', '--no-skills', '--no-session', '--trust'], directory, report,
                       timeout=timeout, width=width)


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('--watch', action='store_true', help='Experimental five-minute refresh; Ctrl+C stops and reaps the child')
    options = args.parse_args()
    last_success = None
    def stop(_signum, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, stop)
    try:
        while True:
            next_refresh = time.monotonic() + INTERVAL
            try:
                data = probe()
                last_success = data['capturedAt']
                output = {'status': 'experimental', 'data': data, 'lastSuccessfulRefresh': last_success}
            except Unavailable as error:
                output = {'status': 'unavailable', 'reason': str(error), 'lastSuccessfulRefresh': last_success}
            except Exception:
                output = {'status': 'unavailable', 'reason': 'probe-failed', 'lastSuccessfulRefresh': last_success}
            print(json.dumps(output), flush=True)
            if not options.watch:
                return 0 if output['status'] == 'experimental' else 1
            time.sleep(max(0, next_refresh - time.monotonic()))
    except KeyboardInterrupt:
        return 130


if __name__ == '__main__':
    sys.exit(main())

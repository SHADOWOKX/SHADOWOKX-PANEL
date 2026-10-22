"""Offline tests: never execute the installed CommandCode CLI or contact its API."""
import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / 'scripts/prototypes/commandcode_usage'
spec = importlib.util.spec_from_file_location('commandcode_probe', DIRECTORY / 'probe.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
try:
    import pyte
except ImportError:
    pyte = None

SCREEN = '''USAGE GOAT Plan · active
█░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 1% used
298 requests this month · 31 days to renew
Usage limits
5-hour ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0%
Weekly █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 2% · resets in 6d 14h
Full breakdown at example.invalid/redacted
Press Esc to close'''


class Parsing(unittest.TestCase):
    def test_screenshot(self):
        value = probe.parse_screen(SCREEN.replace('USAGE GOAT', 'USAGE  GOAT'))
        self.assertEqual(value['plan'], 'GOAT')
        self.assertEqual(value['requestsThisMonth'], 298)
        self.assertEqual(value['monthlyUsedPercent'], 1)
        self.assertEqual(value['windows'][0]['usedPercent'], 0)
        self.assertEqual(value['windows'][1]['resetDisplay'], '6d 14h')
        self.assertEqual(value['renewalDisplay'], '31 days to renew')
        self.assertFalse(any(key in value for key in ('remaining', 'credits', 'spending', 'resetsAt', 'account')))
        self.assertNotIn('example.invalid', json.dumps(value))

    def test_changed_incomplete_duplicate_or_invalid(self):
        for text in [SCREEN.replace('Weekly', 'Seven days'), SCREEN.replace('Press Esc to close', ''),
                     SCREEN + '\nWeekly ░ 2%', SCREEN.replace('1% used', '101% used'),
                     SCREEN.replace('298 requests', 'unknown requests'), SCREEN + '\nNetwork error: secret',
                     SCREEN.replace('31 days', '999 days'), SCREEN.replace('active', 'expired'),
                     SCREEN.replace('6d 14h', 'tomorrow'), 'x' * 65537]:
            with self.subTest(text=text[:20]), self.assertRaises(probe.Unavailable):
                probe.parse_screen(text)

    def test_timers_preserved_without_estimation(self):
        for duration in ['6d', '4h 59m', '1h', '59m']:
            self.assertEqual(probe.parse_screen(SCREEN.replace('6d 14h', duration))['windows'][1]['resetDisplay'], duration)

    @unittest.skipUnless(pyte, 'Install the pinned prototype dependencies for terminal emulation tests')
    def test_ansi_redraw_and_fragmented_utf8(self):
        import codecs
        screen = pyte.Screen(140, 60)
        stream = pyte.Stream(screen)
        decoder = codecs.getincrementaldecoder('utf-8')('replace')
        data = ('old misleading usage\x1b[2J\x1b[H\x1b[35m' + SCREEN.replace('\n', '\r\n') + '\x1b[0m').encode()
        for byte in data:
            stream.feed(decoder.decode(bytes([byte])))
        self.assertEqual(probe.parse_screen('\n'.join(screen.display)), probe.parse_screen(SCREEN))

    def test_platform_is_fail_closed(self):
        with patch.object(probe.sys, 'platform', 'win32'), self.assertRaisesRegex(probe.Unavailable, 'platform-unvalidated'):
            probe.probe()
        self.assertEqual(probe.INTERVAL, 300)

    def test_cli_update_is_rejected_before_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'dist').mkdir()
            entry = root / 'dist/index.mjs'
            entry.write_text('not the reviewed CLI')
            (root / 'dist/cli.mjs').write_text('not the reviewed CLI')
            (root / 'package.json').write_text(json.dumps({'name': 'command-code', 'version': '1.75.0'}))
            with patch.object(probe.shutil, 'which', return_value=str(entry)), self.assertRaisesRegex(probe.Unavailable, 'unreviewed-cli-version'):
                probe.reviewed_entry()
            (root / 'package.json').write_text(json.dumps({'name': 'command-code', 'version': probe.VERSION}))
            with patch.object(probe.shutil, 'which', return_value=str(entry)), self.assertRaisesRegex(probe.Unavailable, 'unreviewed-cli-build'):
                probe.reviewed_entry()

    def test_corrupt_report_is_unavailable(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / 'report'
            for raw in ['not JSON', '{"apiKey":"private-key"}', json.dumps(dict.fromkeys(probe.COUNTERS, True))]:
                report.write_text(raw)
                with self.assertRaisesRegex(probe.Unavailable, 'instrumentation-failed'):
                    probe.counters(report)

    def test_watch_refresh_preserves_only_last_success_time(self):
        output = io.StringIO()
        with patch.object(probe.sys, 'argv', ['probe', '--watch']), \
             patch.object(probe, 'probe', side_effect=[{'capturedAt': '2026-10-03T00:00:00+00:00'}, probe.Unavailable('read-failed')]), \
             patch.object(probe.time, 'monotonic', side_effect=[0, 20, 300, 320]), \
             patch.object(probe.time, 'sleep', side_effect=[None, KeyboardInterrupt]), \
             contextlib.redirect_stdout(output):
            self.assertEqual(probe.main(), 130)
            self.assertEqual(probe.time.sleep.call_args_list[0].args, (280,))
        first, second = map(json.loads, output.getvalue().splitlines())
        self.assertEqual(second['lastSuccessfulRefresh'], first['lastSuccessfulRefresh'])
        self.assertEqual(second['status'], 'unavailable')
        self.assertNotIn('data', second)


@unittest.skipUnless(shutil.which('node'), 'Node required for request guard tests')
class Guard(unittest.TestCase):
    def test_read_only_network_and_children(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / 'counts.json'
            fixture = Path(directory) / 'fixture.cjs'
            # Mock transports only: the tests make no network connections.
            fixture.write_text('''const http=require('node:http');
const {EventEmitter}=require('node:events');
let writes=0;
globalThis.fetch=async(url,options)=>{
 if(options?.method && options.method!=='GET')writes++;
 return new Response(url.endsWith('/bad-json')?'not-json':'{}',{status:url.endsWith('/error')?429:200});
};
http.request=(url,options)=>{
 if(options?.method && options.method!=='GET')writes++;
 const request=new EventEmitter();
 request.end=()=>request.emit('response',{statusCode:200});
 return request;
};
require(GUARD);
(async()=>{
 const url='https://example.invalid';
 await (await fetch(url)).json();
 await fetch(url+'/error');
 try {await (await fetch(url+'/bad-json')).json();}catch{}
 for(const path of ['/v1/messages','/telemetry']) {try {await fetch(url+path,{method:'POST',body:'private-key'});}catch{}}
 try {require('node:child_process').execSync('never-run');}catch{}
 try {new (require('node:worker_threads').Worker)('never-run');}catch{}
 try {http.request(url,{method:'POST'});}catch{}
 http.get(url);
 if(writes)process.exitCode=2;
})();'''.replace('GUARD', json.dumps(str(DIRECTORY / 'readonly.cjs'))))
            env = dict(os.environ, COMMANDCODE_PROBE_REPORT=str(report))
            env.pop('NODE_OPTIONS', None)
            subprocess.run(['node', str(fixture)], env=env,
                           check=True, timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            counts = probe.counters(report)
            self.assertEqual(counts, {'get': 4, 'blockedWrites': 3, 'blockedChildren': 2, 'failedReads': 2, 'blockedInference': 1})
            self.assertNotIn('private-key', report.read_text())
            if sys.platform == 'linux':
                self.assertEqual(report.stat().st_mode & 0o777, 0o600)


@unittest.skipUnless(pyte and sys.platform == 'linux' and shutil.which('node'), 'Linux PTY and pinned terminal dependencies required')
class Transport(unittest.TestCase):
    def fixture(self, directory, kind):
        report = Path(directory) / 'counts.json'
        pid = Path(directory) / 'pid'
        fixture = Path(directory) / 'fake.cjs'
        fixture.write_text('''const fs=require('node:fs');
fs.writeFileSync('pid',String(process.pid));
process.stdin.setRawMode(true);process.stdin.resume();
process.stdout.write('Command Code v1.74.0\\r\\n');
const counts={get:0,blockedWrites:0,blockedChildren:0,failedReads:0,blockedInference:0};
fs.writeFileSync(process.env.COMMANDCODE_PROBE_REPORT,JSON.stringify(counts));
let text='';
process.stdin.on('data',chunk=>{
 text+=chunk;
 if(text.includes('\\r')) {
  if(text!=='/usage\\r')process.exit(3);
  counts.get=4;
  if(KIND==='failed')counts.failedReads=1;
  if(KIND==='inference')counts.blockedInference=1;
  fs.writeFileSync(process.env.COMMANDCODE_PROBE_REPORT,JSON.stringify(counts));
  if(KIND==='auth')process.stdout.write('Not authenticated');
  else process.stdout.write('\\x1b[2J\\x1b[H'+SCREEN.replace(/\\n/g,'\\r\\n'));
 }
});
setInterval(()=>{},1000);'''.replace('KIND', json.dumps(kind)).replace('SCREEN', json.dumps(SCREEN)))
        return ['node', str(fixture)], report, pid

    def test_capture_and_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            argv, report, pid = self.fixture(directory, 'success')
            value = probe.capture(argv, directory, report, timeout=12, width=100)
            self.assertEqual(value['requestsThisMonth'], 298)
            self.assertTrue(value['capturedAt'].endswith('+00:00'))
            with self.assertRaises(ProcessLookupError):
                os.kill(int(pid.read_text()), 0)

    def test_timeout_auth_and_network_failure_cleanup(self):
        for kind, timeout, reason in [('hang', 1, 'timeout'), ('auth', 12, 'authentication-required'),
                                      ('failed', 12, 'read-failed'), ('inference', 12, 'inference-attempt-blocked')]:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                argv, report, pid = self.fixture(directory, kind)
                with self.assertRaisesRegex(probe.Unavailable, reason):
                    probe.capture(argv, directory, report, timeout=timeout)
                with self.assertRaises(ProcessLookupError):
                    os.kill(int(pid.read_text()), 0)

    def test_supervisor_cancellation_reaps_child(self):
        with tempfile.TemporaryDirectory() as directory:
            argv, report, pid = self.fixture(directory, 'hang')
            helper = Path(directory) / 'supervisor.py'
            helper.write_text('''import importlib.util,signal
spec=importlib.util.spec_from_file_location('probe',PROBE)
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
def stop(*args):raise KeyboardInterrupt()
signal.signal(signal.SIGTERM,stop)
try:p.capture(ARGV,DIRECTORY,REPORT,timeout=30)
except KeyboardInterrupt:pass
'''.replace('PROBE', repr(str(DIRECTORY / 'probe.py'))).replace('ARGV', repr(argv))
                .replace('DIRECTORY', repr(directory)).replace('REPORT', "__import__('pathlib').Path(" + repr(str(report)) + ')'))
            process = subprocess.Popen([sys.executable, str(helper)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                deadline = time.monotonic() + 5
                while not pid.exists() and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertTrue(pid.exists())
                process.terminate()
                process.wait(timeout=6)
                with self.assertRaises(ProcessLookupError):
                    os.kill(int(pid.read_text()), 0)
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait()


if __name__ == '__main__':
    unittest.main()

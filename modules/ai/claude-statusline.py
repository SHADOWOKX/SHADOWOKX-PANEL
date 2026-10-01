#!/usr/bin/env python3
"""Export only Claude usage fields; never persist prompts or credential data."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--previous-command')
    args = parser.parse_args()
    original = sys.stdin.read(1024 * 1024)
    data = json.loads(original)
    rates = data.get('rate_limits') or {}
    export = {'updatedAt': int(time.time() * 1000), 'rate_limits': {}}
    for name in ('five_hour', 'seven_day', 'spend_limit'):
        window = rates.get(name)
        if isinstance(window, dict):
            export['rate_limits'][name] = {
                key: window[key] for key in ('used_percentage', 'resets_at') if key in window
            }
    directory = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'shadow-panel' / 'usage'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix='.claude-', dir=directory)
    try:
        with os.fdopen(fd, 'w') as out:
            json.dump(export, out)
            out.write('\n')
        os.replace(temporary, directory / 'claude.json')
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    parts = []
    for name, label in (('five_hour', '5h'), ('seven_day', '7d')):
        value = export['rate_limits'].get(name, {}).get('used_percentage')
        if isinstance(value, (int, float)):
            parts.append(f'{label}: {value:.0f}% used')
    if args.previous_command:
        try:
            result = subprocess.run(args.previous_command, shell=True, input=original, text=True,
                                    capture_output=True, timeout=5)
            if result.stdout:
                print(result.stdout.rstrip())
                return
        except (OSError, subprocess.TimeoutExpired):
            pass
    print('Claude | ' + (' · '.join(parts) or 'Usage not yet reported'))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, TypeError):
        print('Claude | Usage unavailable')

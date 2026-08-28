#!/bin/sh
set -eu

if ! command -v rg >/dev/null 2>&1; then
  printf '%s\n' 'ripgrep (rg) is required to filter Shadowokx Panel logs.' >&2
  exit 1
fi

shadow_log_file=$(mktemp)
trap 'rm -f -- "$shadow_log_file"' EXIT HUP INT TERM
if ! journalctl --user -b -o cat >"$shadow_log_file"; then
  printf '%s\n' 'The current user journal could not be read.' >&2
  exit 1
fi
if ! rg 'Shadowokx Panel|shadow-panel@shadowokx' "$shadow_log_file"; then
  printf '%s\n' 'No Shadowokx Panel messages were found in the current user journal.'
fi

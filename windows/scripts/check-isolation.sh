#!/bin/sh
set -eu

windows_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repository_root=$(CDPATH= cd -- "$windows_root/.." && pwd)

xmllint --noout \
  "$windows_root/src/ShadowokxPanel/App.xaml" \
  "$windows_root/src/ShadowokxPanel/MainWindow.xaml" \
  "$windows_root/src/ShadowokxPanel/SettingsWindow.xaml" \
  "$windows_root/src/ShadowokxPanel/ShadowokxPanel.csproj" \
  "$windows_root/src/ShadowokxPanel.Core/ShadowokxPanel.Core.csproj" \
  "$windows_root/tests/ShadowokxPanel.Core.Tests/ShadowokxPanel.Core.Tests.csproj"

if rg -n '/home/|C:\\Users\\shadowokx|Bearer[[:space:]]+[[:alnum:]_.-]+|sk-[A-Za-z0-9_-]{20,}' \
  --glob '!**/tests/**' --glob '!**/check-isolation.sh' "$windows_root"; then
  printf '%s\n' 'Windows source contains a machine-specific path or credential-shaped value.' >&2
  exit 1
fi

if find "$windows_root" -type f \( -name '*.json' -o -name '*.log' \) | \
  rg '/(cache|data|logs)/'; then
  printf '%s\n' 'Windows runtime data was found in the repository.' >&2
  exit 1
fi

git -C "$repository_root" diff --name-only linux-v2.3.3 -- | \
  rg -v '^(windows/|README\.md$)' >"$windows_root/.isolation-diff" || true
if test -s "$windows_root/.isolation-diff"; then
  printf '%s\n' 'A Linux implementation file changed during Windows development:' >&2
  sed -n '1,120p' "$windows_root/.isolation-diff" >&2
  rm -f "$windows_root/.isolation-diff"
  exit 1
fi
rm -f "$windows_root/.isolation-diff"

printf '%s\n' 'Windows project structure and Linux isolation checks passed.'

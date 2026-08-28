#!/bin/sh
set -eu

shadow_project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
shadow_test_dir=$(mktemp -d)
trap 'rm -rf -- "$shadow_test_dir"' EXIT HUP INT TERM

cd "$shadow_project_dir"

gjs -m scripts/validate-json.mjs metadata.json package.json
gjs -m scripts/validate-release.mjs "$shadow_project_dir"
xmllint --noout schemas/org.gnome.shell.extensions.shadow-panel.gschema.xml
glib-compile-schemas --strict --dry-run schemas

SHADOW_PANEL_TEST_ISOLATED=1 \
XDG_DATA_HOME="$shadow_test_dir/data" \
XDG_CACHE_HOME="$shadow_test_dir/cache" \
gjs -m tests/run-tests.mjs

shadow_clutter_typelib=$(find /usr/lib -path '*/mutter-18/Clutter-18.typelib' -print -quit)
test -n "$shadow_clutter_typelib"
shadow_mutter_typelib_dir=$(dirname -- "$shadow_clutter_typelib")
LD_LIBRARY_PATH="/usr/lib/gnome-shell${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
GI_TYPELIB_PATH="/usr/lib/gnome-shell:$shadow_mutter_typelib_dir${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}" \
gjs -m tests/import-ui.mjs

./scripts/package.sh "$shadow_test_dir/package"
test -f "$shadow_test_dir/package/shadow-panel@shadowokx.shell-extension.zip"
unzip -t "$shadow_test_dir/package/shadow-panel@shadowokx.shell-extension.zip" >/dev/null
unzip -Z1 "$shadow_test_dir/package/shadow-panel@shadowokx.shell-extension.zip" | \
  grep -qx 'modules/codex/shareWorker.js'
unzip -Z1 "$shadow_test_dir/package/shadow-panel@shadowokx.shell-extension.zip" | \
  grep -qx 'icons/chatgpt.png'
if unzip -Z1 "$shadow_test_dir/package/shadow-panel@shadowokx.shell-extension.zip" | \
  rg -i '(^|/)(notes|obsidian|tasks|todo|tools)(/|\.|$)'; then
  printf '%s\n' 'Removed productivity-module code was found in the release archive.' >&2
  exit 1
fi

printf '%s\n' 'Shadowokx Panel checks passed.'

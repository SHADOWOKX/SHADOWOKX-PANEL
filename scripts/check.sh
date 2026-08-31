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

for shadow_scenario in authenticated unauthenticated missing existing-history; do
  shadow_case_dir="$shadow_test_dir/first-run-$shadow_scenario"
  mkdir -p "$shadow_case_dir/home" "$shadow_case_dir/data" "$shadow_case_dir/cache"
  HOME="$shadow_case_dir/home" \
  PATH="/usr/bin:/bin" \
  XDG_DATA_HOME="$shadow_case_dir/data" \
  XDG_CACHE_HOME="$shadow_case_dir/cache" \
  SHADOW_PANEL_TEST_ISOLATED=1 \
  gjs -m tests/first-run-codex.mjs "$shadow_scenario"
done

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
unzip -Z1 "$shadow_test_dir/package/shadow-panel@shadowokx.shell-extension.zip" | \
  grep -qx 'icons/usage-high-symbolic.svg'
if unzip -Z1 "$shadow_test_dir/package/shadow-panel@shadowokx.shell-extension.zip" | \
  rg -i '(^|/)(notes|obsidian|tasks|todo|tools)(/|\.|$)'; then
  printf '%s\n' 'Removed productivity-module code was found in the release archive.' >&2
  exit 1
fi
if unzip -Z1 "$shadow_test_dir/package/shadow-panel@shadowokx.shell-extension.zip" | \
  rg -i '(^|/)(codex(-history)?|weather)\.json$|\.(log|dump|trace)$'; then
  printf '%s\n' 'Per-user runtime data was found in the release archive.' >&2
  exit 1
fi
if rg -n '/home/[[:alnum:]_.-]+/' \
  --glob '!scripts/check.sh' --glob '!dist/**' --glob '!schemas/gschemas.compiled' .; then
  printf '%s\n' 'A machine-specific home path was found in the repository.' >&2
  exit 1
fi

printf '%s\n' 'Shadowokx Panel checks passed.'

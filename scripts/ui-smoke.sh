#!/bin/sh
set -eu

shadow_project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
shadow_runtime_dir=$(mktemp -d)
shadow_shell_log="$shadow_runtime_dir/gnome-shell.log"
shadow_ui_report="$shadow_runtime_dir/ui-report.json"
shadow_ui_density=${SHADOW_UI_DENSITY:-comfortable}
shadow_ui_width=${SHADOW_UI_WIDTH:-standard}
shadow_ui_height=${SHADOW_UI_HEIGHT:-768}
shadow_text_scale=${SHADOW_TEXT_SCALE:-1.0}
case ${SHADOW_EXPECT_SCROLL:-false} in
  1|true|yes) shadow_expect_scroll=true ;;
  *) shadow_expect_scroll=false ;;
esac
shadow_cleanup() {
  rm -rf -- "$shadow_runtime_dir"
}
trap shadow_cleanup EXIT HUP INT TERM

mkdir -p "$shadow_runtime_dir/data" \
  "$shadow_runtime_dir/config" \
  "$shadow_runtime_dir/cache" \
  "$shadow_runtime_dir/run"
chmod 700 "$shadow_runtime_dir/run"

XDG_DATA_HOME="$shadow_runtime_dir/data" "$shadow_project_dir/install.sh" >/dev/null
shadow_helper_dir="$shadow_runtime_dir/data/gnome-shell/extensions/shadow-panel-ui-smoke@shadowokx"
mkdir -p "$shadow_helper_dir"
cp "$shadow_project_dir/tests/ui-smoke/metadata.json" "$shadow_helper_dir/metadata.json"
cp "$shadow_project_dir/tests/ui-smoke/extension.js" "$shadow_helper_dir/extension.js"

export XDG_DATA_HOME="$shadow_runtime_dir/data"
export XDG_CONFIG_HOME="$shadow_runtime_dir/config"
export XDG_CACHE_HOME="$shadow_runtime_dir/cache"
export XDG_RUNTIME_DIR="$shadow_runtime_dir/run"
export SHADOW_SHELL_LOG="$shadow_shell_log"
export SHADOW_UI_REPORT="$shadow_ui_report"
export SHADOW_UI_DENSITY="$shadow_ui_density"
export SHADOW_UI_WIDTH="$shadow_ui_width"
export SHADOW_UI_HEIGHT="$shadow_ui_height"
export SHADOW_EXPECT_SCROLL="$shadow_expect_scroll"
export SHADOW_TEXT_SCALE="$shadow_text_scale"
export GSETTINGS_SCHEMA_DIR="$shadow_runtime_dir/data/gnome-shell/extensions/shadow-panel@shadowokx/schemas"

dbus-run-session -- sh -eu -c '
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell.extensions.shadow-panel density "$SHADOW_UI_DENSITY"
  gsettings set org.gnome.shell.extensions.shadow-panel panel-width "$SHADOW_UI_WIDTH"
  gsettings set org.gnome.desktop.interface text-scaling-factor "$SHADOW_TEXT_SCALE"
  gsettings set org.gnome.shell enabled-extensions \
    "['"'"'shadow-panel@shadowokx'"'"', '"'"'shadow-panel-ui-smoke@shadowokx'"'"']"
  gnome-shell --headless --wayland --no-x11 --virtual-monitor "1024x$SHADOW_UI_HEIGHT" >"$SHADOW_SHELL_LOG" 2>&1 &
  shadow_shell_pid=$!
  trap '"'"'kill -TERM "$shadow_shell_pid" 2>/dev/null || true; wait "$shadow_shell_pid" 2>/dev/null || true'"'"' EXIT HUP INT TERM
  for shadow_attempt in $(seq 1 50); do
    test -s "$SHADOW_UI_REPORT" && break
    kill -0 "$shadow_shell_pid"
    sleep 0.5
  done
  test -s "$SHADOW_UI_REPORT"
'

gjs -c "const GLib=imports.gi.GLib; const [, bytes]=GLib.file_get_contents('$shadow_ui_report'); const report=JSON.parse(new TextDecoder().decode(bytes)); const widths=new Set(report.tabSwitches.map(item => item.page.width)); const scrolling=report.tabSwitches.some(item => item.scroll?.needsScroll); const expectScroll='$shadow_expect_scroll' === 'true'; if (!report.reopened || !report.refreshStateExercised || widths.size !== 1 || scrolling !== expectScroll || report.tabSwitches.length !== 4 || report.tabSwitches.some(item => !item.hasExpectedContent || item.page.width <= 0 || item.page.height <= 0 || item.stack.height <= 0 || item.childCount < 2)) throw new Error(JSON.stringify(report)); print(JSON.stringify(report));"

if rg -i -U "shadow-panel[\s\S]{0,900}(error|exception|critical|warning)|(js error|gjs-critical|error parsing stylesheet|stylesheet\.css.*(error|warning))[\s\S]{0,900}shadow-panel" "$shadow_shell_log"; then
  printf '%s\n' 'Shadowokx Panel emitted a UI smoke-test runtime error.' >&2
  exit 1
fi

printf '%s\n' 'Shadowokx Panel UI actors rendered, switched, and reopened successfully.'

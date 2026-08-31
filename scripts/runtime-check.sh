#!/bin/sh
set -eu

shadow_project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
shadow_runtime_dir=$(mktemp -d)
shadow_shell_log="$shadow_runtime_dir/gnome-shell.log"
shadow_session_log="$shadow_runtime_dir/session.log"
shadow_cleanup() {
  rm -rf -- "$shadow_runtime_dir" 2>/dev/null || {
    sleep 1
    rm -rf -- "$shadow_runtime_dir"
  }
}
trap shadow_cleanup EXIT
trap 'exit 130' HUP INT TERM

mkdir -p "$shadow_runtime_dir/data" \
  "$shadow_runtime_dir/config" \
  "$shadow_runtime_dir/cache" \
  "$shadow_runtime_dir/run"
chmod 700 "$shadow_runtime_dir/run"

XDG_DATA_HOME="$shadow_runtime_dir/data" \
  "$shadow_project_dir/install.sh" >/dev/null

export XDG_DATA_HOME="$shadow_runtime_dir/data"
export XDG_CONFIG_HOME="$shadow_runtime_dir/config"
export XDG_CACHE_HOME="$shadow_runtime_dir/cache"
export XDG_RUNTIME_DIR="$shadow_runtime_dir/run"
export SHADOW_SHELL_LOG="$shadow_shell_log"
export GSETTINGS_SCHEMA_DIR="$shadow_runtime_dir/data/gnome-shell/extensions/shadow-panel@shadowokx/schemas"

dbus-run-session -- sh -eu -c '
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell enabled-extensions "['"'"'shadow-panel@shadowokx'"'"']"
  gnome-shell --headless --wayland --no-x11 --virtual-monitor 800x600 >"$SHADOW_SHELL_LOG" 2>&1 &
  shadow_shell_pid=$!
  shadow_stop_shell() {
    kill -TERM "$shadow_shell_pid" 2>/dev/null || true
    wait "$shadow_shell_pid" 2>/dev/null || true
  }
  trap shadow_stop_shell EXIT HUP INT TERM
  shadow_loaded=false
  for shadow_attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if ! kill -0 "$shadow_shell_pid" 2>/dev/null; then
      break
    fi
    shadow_info=$(gnome-extensions info shadow-panel@shadowokx 2>/dev/null || true)
    if printf "%s\n" "$shadow_info" | grep -q "State: ACTIVE"; then
      shadow_loaded=true
      break
    fi
    sleep 0.5
  done
  if test "$shadow_loaded" = true; then
    gsettings set org.gnome.shell.extensions.shadow-panel density compact
    gsettings set org.gnome.shell.extensions.shadow-panel background-theme light-neutral
    gsettings set org.gnome.shell.extensions.shadow-panel theme light
    gsettings set org.gnome.shell.extensions.shadow-panel accent-color orange
    gsettings set org.gnome.shell.extensions.shadow-panel default-tab weather
    gsettings set org.gnome.shell.extensions.shadow-panel show-codex-usage-state true
    gsettings set org.gnome.shell.extensions.shadow-panel show-weather-top-bar false
    gsettings set org.gnome.shell.extensions.shadow-panel show-weather-panel false
    gsettings get org.gnome.shell.extensions.shadow-panel default-tab | grep -q weather
    sleep 1
    shadow_info=$(gnome-extensions info shadow-panel@shadowokx 2>/dev/null || true)
    printf "%s\n" "$shadow_info" | grep -q "State: ACTIVE"
    gsettings set org.gnome.shell.extensions.shadow-panel show-weather-panel true
    gsettings set org.gnome.shell.extensions.shadow-panel show-weather-top-bar true
    sleep 1
    gnome-extensions prefs shadow-panel@shadowokx
    sleep 1
    gnome-extensions disable shadow-panel@shadowokx
    sleep 0.5
    shadow_info=$(gnome-extensions info shadow-panel@shadowokx 2>/dev/null || true)
    if printf "%s\n" "$shadow_info" | grep -q "State: ACTIVE"; then
      exit 4
    fi
    gnome-extensions enable shadow-panel@shadowokx
    shadow_reloaded=false
    for shadow_attempt in 1 2 3 4 5 6 7 8 9 10; do
      shadow_info=$(gnome-extensions info shadow-panel@shadowokx 2>/dev/null || true)
      if printf "%s\n" "$shadow_info" | grep -q "State: ACTIVE"; then
        shadow_reloaded=true
        break
      fi
      sleep 0.25
    done
    test "$shadow_reloaded" = true
  fi
  test "$shadow_loaded" = true
' >"$shadow_session_log" 2>&1 || {
  printf '%s\n' 'Headless GNOME Shell did not report Shadowokx Panel as active.' >&2
  tail -n 160 "$shadow_session_log" >&2
  tail -n 160 "$shadow_shell_log" >&2
  exit 1
}

if rg -i -U "shadow-panel[\s\S]{0,900}(error|exception|critical|warning)|(js error|gjs-critical|error parsing stylesheet|stylesheet\.css.*(error|warning))[\s\S]{0,900}shadow-panel" \
  "$shadow_shell_log" "$shadow_session_log"; then
  printf '%s\n' 'Shadowokx Panel emitted a runtime error.' >&2
  exit 1
fi

printf '%s\n' 'Shadowokx Panel and its Preferences loaded successfully in an isolated headless GNOME Shell.'

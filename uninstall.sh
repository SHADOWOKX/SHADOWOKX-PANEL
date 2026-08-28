#!/bin/sh
set -eu

shadow_uuid='shadow-panel@shadowokx'
shadow_data_home=${XDG_DATA_HOME:-"$HOME/.local/share"}
shadow_extensions_dir="$shadow_data_home/gnome-shell/extensions"
shadow_destination="$shadow_extensions_dir/$shadow_uuid"

case "$shadow_destination" in
  "$shadow_extensions_dir/$shadow_uuid") ;;
  *) printf '%s\n' 'Refusing unsafe extension destination.' >&2; exit 1 ;;
esac

gnome-extensions disable "$shadow_uuid" 2>/dev/null || true
rm -rf -- "$shadow_destination"

printf '%s\n' \
  'Shadowokx Panel was removed.' \
  'Provider caches were preserved under the XDG cache directory.'

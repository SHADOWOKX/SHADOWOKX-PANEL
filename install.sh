#!/bin/sh
set -eu

shadow_project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
shadow_uuid='shadow-panel@shadowokx'
shadow_data_home=${XDG_DATA_HOME:-"$HOME/.local/share"}
shadow_extensions_dir="$shadow_data_home/gnome-shell/extensions"
shadow_destination="$shadow_extensions_dir/$shadow_uuid"

mkdir -p "$shadow_extensions_dir"
shadow_stage=$(mktemp -d "$shadow_extensions_dir/.shadow-panel.XXXXXX")
shadow_backup_root=$(mktemp -d "$shadow_extensions_dir/.shadow-panel-backup.XXXXXX")
shadow_backup="$shadow_backup_root/$shadow_uuid"
shadow_swap_complete=false
shadow_restore_backup() {
  if test -e "$shadow_backup" || test -L "$shadow_backup"; then
    if ! test -e "$shadow_destination" && ! test -L "$shadow_destination"; then
      if ! mv "$shadow_backup" "$shadow_destination"; then
        printf '%s\n' \
          'The previous installation could not be restored automatically.' \
          "Its backup was preserved at: $shadow_backup" >&2
        return 1
      fi
    fi
  fi
  return 0
}
shadow_cleanup() {
  rm -rf -- "$shadow_stage"
  if test "$shadow_swap_complete" != true; then
    if ! shadow_restore_backup; then
      return
    fi
  fi
  rm -rf -- "$shadow_backup_root"
}
trap shadow_cleanup EXIT
trap 'exit 130' HUP INT TERM
mkdir -p "$shadow_stage/$shadow_uuid"

cp "$shadow_project_dir/extension.js" \
  "$shadow_project_dir/metadata.json" \
  "$shadow_project_dir/NOTICE.md" \
  "$shadow_project_dir/prefs.js" \
  "$shadow_project_dir/stylesheet.css" \
  "$shadow_project_dir/VERSION" \
  "$shadow_project_dir/update-helper.py" \
  "$shadow_stage/$shadow_uuid/"
cp -R "$shadow_project_dir/lib" \
  "$shadow_project_dir/modules" \
  "$shadow_project_dir/services" \
  "$shadow_project_dir/ui" \
  "$shadow_project_dir/icons" \
  "$shadow_project_dir/schemas" \
  "$shadow_stage/$shadow_uuid/"

glib-compile-schemas --strict "$shadow_stage/$shadow_uuid/schemas"
gjs -m "$shadow_project_dir/scripts/validate-json.mjs" \
  "$shadow_stage/$shadow_uuid/metadata.json"
gjs -m "$shadow_project_dir/scripts/validate-release.mjs" "$shadow_project_dir"

case "$shadow_destination" in
  "$shadow_extensions_dir/$shadow_uuid") ;;
  *) printf '%s\n' 'Refusing unsafe extension destination.' >&2; exit 1 ;;
esac

gnome-extensions disable "$shadow_uuid" 2>/dev/null || true
if test -e "$shadow_destination" || test -L "$shadow_destination"; then
  mv "$shadow_destination" "$shadow_backup"
fi
if ! mv "$shadow_stage/$shadow_uuid" "$shadow_destination"; then
  printf '%s\n' 'Installation failed; attempting to restore the previous Shadowokx Panel version.' >&2
  exit 1
fi
shadow_swap_complete=true

printf '\n%s\n' \
  '✓ Shadowokx Panel installed successfully.' \
  '' \
  "Installed to: $shadow_destination" \
  '' \
  'Next step:' \
  '  1. Log out and back in once so GNOME Shell discovers the extension.' \
  "  2. Enable it with: gnome-extensions enable $shadow_uuid" \
  '' \
  "Preferences: gnome-extensions prefs $shadow_uuid"

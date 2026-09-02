#!/bin/sh
set -eu

shadow_project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
shadow_output_dir=${1:-"$shadow_project_dir/dist"}

mkdir -p "$shadow_output_dir"
gjs -m "$shadow_project_dir/scripts/validate-json.mjs" \
  "$shadow_project_dir/metadata.json" \
  "$shadow_project_dir/package.json"
gjs -m "$shadow_project_dir/scripts/validate-release.mjs" "$shadow_project_dir"
glib-compile-schemas --strict --dry-run "$shadow_project_dir/schemas"

gnome-extensions pack \
  --force \
  --out-dir="$shadow_output_dir" \
  --schema="$shadow_project_dir/schemas/org.gnome.shell.extensions.shadow-panel.gschema.xml" \
  --extra-source="$shadow_project_dir/lib" \
  --extra-source="$shadow_project_dir/modules" \
  --extra-source="$shadow_project_dir/services" \
  --extra-source="$shadow_project_dir/ui" \
  --extra-source="$shadow_project_dir/icons" \
  --extra-source="$shadow_project_dir/README.md" \
  --extra-source="$shadow_project_dir/NOTICE.md" \
  --extra-source="$shadow_project_dir/LICENSE" \
  --extra-source="$shadow_project_dir/VERSION" \
  --extra-source="$shadow_project_dir/update-helper.py" \
  "$shadow_project_dir"

printf 'Package created in %s\n' "$shadow_output_dir"

#!/bin/sh
# Install the verified release package; the same command updates an existing install.
set -eu

shadow_version='2.3.8'
shadow_uuid='shadow-panel@shadowokx'
shadow_release="https://github.com/SHADOWOKX/SHADOWOKX-PANEL/releases/download/linux-v$shadow_version"
shadow_package="$shadow_uuid.shell-extension.zip"

for shadow_tool in curl gnome-extensions sha256sum mktemp; do
    if ! command -v "$shadow_tool" >/dev/null 2>&1; then
        printf 'Required command is missing: %s\n' "$shadow_tool" >&2
        exit 1
    fi
done

if command -v gnome-shell >/dev/null 2>&1; then
    case "$(gnome-shell --version)" in
        'GNOME Shell 50'*) ;;
        *) printf '%s\n' 'This package requires GNOME Shell 50.' >&2; exit 1 ;;
    esac
fi

shadow_stage=$(mktemp -d)
trap 'rm -rf -- "$shadow_stage"' EXIT
trap 'exit 130' HUP INT TERM

printf 'Downloading Shadowokx Panel %s…\n' "$shadow_version"
curl --fail --silent --show-error --location --retry 3 \
    "$shadow_release/$shadow_package" -o "$shadow_stage/$shadow_package"
curl --fail --silent --show-error --location --retry 3 \
    "$shadow_release/checksums-linux.txt" -o "$shadow_stage/checksums-linux.txt"
(
    cd "$shadow_stage"
    sha256sum --check --status checksums-linux.txt
)

gnome-extensions install --force "$shadow_stage/$shadow_package"
gnome-extensions enable "$shadow_uuid" 2>/dev/null || true
printf '\nShadowokx Panel %s installed.\nLog out and back in to load this version.\n' "$shadow_version"
printf 'If it is not visible after logging in: gnome-extensions enable %s\n' "$shadow_uuid"

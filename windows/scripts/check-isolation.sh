#!/bin/sh
set -eu

windows_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repository_root=$(CDPATH= cd -- "$windows_root/.." && pwd)

xmllint --noout \
  "$windows_root/Directory.Build.props" \
  "$windows_root/src/ShadowokxPanel/App.xaml" \
  "$windows_root/src/ShadowokxPanel/MainWindow.xaml" \
  "$windows_root/src/ShadowokxPanel/SettingsWindow.xaml" \
  "$windows_root/src/ShadowokxPanel/ShadowokxPanel.csproj" \
  "$windows_root/src/ShadowokxPanel.Core/ShadowokxPanel.Core.csproj" \
  "$windows_root/tests/ShadowokxPanel.Core.Tests/ShadowokxPanel.Core.Tests.csproj"

first_merged_resource=$(xmllint --xpath \
  'local-name((//*[local-name()="ResourceDictionary.MergedDictionaries"]/*)[1])' \
  "$windows_root/src/ShadowokxPanel/App.xaml")
if test "$first_merged_resource" != 'XamlControlsResources'; then
  printf '%s\n' 'App.xaml must merge XamlControlsResources before custom resources.' >&2
  exit 1
fi

if rg -n 'x:Key="TabViewButtonBackground"' "$windows_root/src/ShadowokxPanel"; then
  printf '%s\n' 'Do not mask missing WinUI framework resources with a local TabView brush.' >&2
  exit 1
fi

for required_file in \
  "$windows_root/scripts/release.ps1" \
  "$windows_root/scripts/validate-publish.ps1" \
  "$windows_root/packaging/ShadowokxPanel.iss" \
  "$windows_root/src/ShadowokxPanel/Assets/ShadowokxPanel.ico" \
  "$windows_root/docs/RELEASE-QA.md"
do
  if ! test -f "$required_file"; then
    printf '%s\n' "Required Windows release file is missing: $required_file" >&2
    exit 1
  fi
done

if ! grep -Fq '<ApplicationIcon>Assets\ShadowokxPanel.ico</ApplicationIcon>' \
  "$windows_root/src/ShadowokxPanel/ShadowokxPanel.csproj"; then
  printf '%s\n' 'The Windows executable icon is not configured.' >&2
  exit 1
fi

if ! grep -Fq 'PrivilegesRequired=lowest' "$windows_root/packaging/ShadowokxPanel.iss" || \
   grep -Fq 'PrivilegesRequiredOverridesAllowed' "$windows_root/packaging/ShadowokxPanel.iss"; then
  printf '%s\n' 'The installer must remain strictly per-user and non-elevated.' >&2
  exit 1
fi

for required_release_text in \
  'ShadowokxPanel-Setup-x64' \
  'ShadowokxPanel-Portable-' \
  'checksums.txt' \
  'validate-publish.ps1'
do
  if ! grep -Fq "$required_release_text" "$windows_root/scripts/release.ps1"; then
    printf '%s\n' "Release pipeline is missing required validation/output: $required_release_text" >&2
    exit 1
  fi
done

if rg -n 'resources\.pri|ShadowokxPanel-[0-9].*-win-x64-setup' \
  "$windows_root/scripts" "$windows_root/packaging" "$windows_root/README.md"; then
  printf '%s\n' 'Windows release files contain an obsolete PRI or artifact-name assumption.' >&2
  exit 1
fi

if rg -n '/home/|C:\\Users\\shadowokx|Bearer[[:space:]]+[[:alnum:]_.-]+|sk-[A-Za-z0-9_-]{20,}' \
  --glob '!**/tests/**' \
  --glob '!**/check-isolation.sh' \
  --glob '!**/validate-publish.ps1' \
  "$windows_root"; then
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

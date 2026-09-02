# Updates and releases

Shadowokx Panel uses GitHub Releases for immutable release files and the
`release-metadata` branch for a small mutable `channels.json` index. A source
commit, CI artifact, or passing test run is not a release and cannot move the
Stable pointer.

## User update behavior

The first release containing the updater still requires one final manual
installation. After that, automatic checks are enabled by default and can be
managed under **Preferences → Updates**. Checks never install automatically.

- **Stable** receives only newer final releases.
- **Beta** receives newer Beta or Stable releases.
- Developer packages are maintainer artifacts and are not offered in the
  normal preferences UI.

The application checks after a short startup delay and approximately every 12
hours. GitHub outages, malformed metadata, and download failures leave the
currently installed application usable. No account, Codex, weather, location,
or device data is sent by the updater.

## Release contract

Every Beta or Stable GitHub Release contains these exact assets:

```text
ShadowokxPanel-Setup-x64.exe
ShadowokxPanel-Portable-x64.zip
ShadowokxPanel-Linux.zip
update.json
checksums.txt
```

`update.json` schema version 1 records the semantic version, channel, source
commit for each platform, workflow run, build time, compatibility, artifact
size, and SHA-256. `rollout` is reserved for future phased rollout; clients
currently accept only 100%. Signature fields are reserved but deliberately
empty until a real signing key and protected signing service exist.

`minimum_updater_version` is a separate updater-protocol capability version,
not the product's prerelease version. This prevents a fully capable Beta or
Developer build from being rejected merely because SemVer correctly ranks it
below the final release with the same base version.

SHA-256 detects corruption or an artifact that differs from the trusted
manifest. It does not protect against an attacker who controls the GitHub
repository and can replace both metadata and artifacts. Windows Authenticode
and signed manifests remain future hardening work; the project never pretends
unsigned builds are signed.

## Maintainer flow

### Developer build

Pushes to `main` and `windows-port` run platform CI and retain short-lived
developer artifacts. To create a coordinated cross-platform developer build,
run **Actions → Developer cross-platform build → Run workflow**, selecting the
Linux and Windows refs. It has read-only repository permission and cannot
publish a release or change any channel.

### Beta

1. Put the desired base version in `/VERSION` on both source branches.
2. Run **Publish Beta release** manually.
3. Enter a prerelease version such as `2.6.0-beta.1` and exact source refs.
4. Verify the workflow's tests, native WinUI build, package validation,
   manifest validation, and checksums.
5. Test the resulting GitHub prerelease on opted-in devices.

Only after the immutable release is successfully created does the workflow
move the Beta pointer in `channels.json`. Stable users never read it.

### Stable promotion

1. Finish Beta/manual testing and place the stable base version in `/VERSION`.
2. Run **Promote Stable release** manually.
3. Enter the stable version, exact refs, and `PROMOTE TO STABLE`.
4. Optionally enter a source Beta. The workflow then rebuilds the exact Linux
   and Windows commit SHAs recorded in that Beta manifest.
5. Approve the `production` GitHub Environment if reviewers are configured.

The Stable workflow reruns all gates, creates a normal GitHub Release, and only
then moves the Stable channel pointer. Beta and Stable semantic versions differ
inside both applications and installers, so Stable is rebuilt from the exact
tested source SHAs rather than claiming byte-identical promotion. Checksums and
provenance identify the resulting Stable artifacts exactly.

### Revoke a bad release

Run **Revoke released version** manually, enter the semantic version and
`REVOKE`, and approve the `production` environment if configured. The workflow
removes that version from every active channel and adds it to the central
revocation list. Clients that have not installed it silently skip it. Already
installed clients are never remotely removed or downgraded.

For an emergency Stable failure: revoke the bad version, fix it, create and
test a Developer build, optionally publish a Beta hotfix, then manually publish
the next Stable patch. Clients on the revoked version see the replacement as an
important update when it becomes available.

## Platform installation safety

On Linux, the extension downloads to its per-user cache and verifies exact
size and SHA-256. A separately copied helper validates archive paths, symlinks,
UUID, metadata, version, and required files before replacing anything. It backs
up only the per-user extension directory, disables the extension, performs an
atomic directory replacement, enables it, and restores the backup on failure.
Tasks, settings, Codex history, and weather caches live outside that directory.
GNOME Shell is never forcibly restarted; a sign-out recommendation is shown.

On Windows, the installed build verifies the exact installer asset before
launching the existing per-user Inno Setup upgrade flow. Portable builds are
never silently converted to installed builds. `%LOCALAPPDATA%\ShadowokxPanel`
is outside the program directory and remains untouched.

## Repository protection

- Configure required reviewers on the `production` GitHub Environment.
- Protect `main`, `windows-port`, and `release-metadata` as appropriate.
- Keep default workflow permissions read-only.
- Never add private signing keys or long-lived personal tokens to the repo.
- Stable remains a manual workflow even if all CI checks pass.

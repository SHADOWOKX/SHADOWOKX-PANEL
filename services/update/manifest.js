import {canUpgrade, compareSemver, parseSemver, versionChannel} from './semver.js';

export const UPDATE_SCHEMA_VERSION = 1;
export const UPDATE_PRODUCT = 'shadowokx-panel';
export const UPDATE_CHANNELS = Object.freeze(['stable', 'beta', 'developer']);

const HTTPS = /^https:\/\//i;
const SHA256 = /^[0-9a-f]{64}$/i;
const COMMIT = /^[0-9a-f]{40}$/i;

function object(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`${name} must be an object`);
    return value;
}

function string(value, name, maximum = 2048) {
    if (typeof value !== 'string' || value.length === 0 || value.length > maximum)
        throw new Error(`${name} is invalid`);
    return value;
}

function httpsUrl(value, name) {
    const url = string(value, name);
    if (!HTTPS.test(url))
        throw new Error(`${name} must use HTTPS`);
    return url;
}

function releaseReference(value, name) {
    const reference = object(value, name);
    const version = string(reference.version, `${name}.version`, 128);
    if (!parseSemver(version))
        throw new Error(`${name}.version is not semantic`);
    const rollout = reference.rollout ?? 100;
    if (!Number.isInteger(rollout) || rollout < 0 || rollout > 100)
        throw new Error(`${name}.rollout is invalid`);
    return Object.freeze({
        version,
        manifestUrl: httpsUrl(reference.manifest_url, `${name}.manifest_url`),
        publishedAt: string(reference.published_at, `${name}.published_at`, 64),
        rollout,
    });
}

export function validateChannelIndex(value) {
    const index = object(value, 'channel index');
    if (index.schema_version !== UPDATE_SCHEMA_VERSION)
        throw new Error('unsupported channel-index schema');
    const channels = object(index.channels, 'channels');
    const normalizedChannels = {};
    for (const channel of UPDATE_CHANNELS) {
        if (channels[channel] !== null && channels[channel] !== undefined)
            normalizedChannels[channel] = releaseReference(channels[channel], `channels.${channel}`);
    }
    const revoked = Array.isArray(index.revoked) ? index.revoked : [];
    if (revoked.some(version => !parseSemver(version)))
        throw new Error('revoked contains an invalid version');
    return Object.freeze({
        schemaVersion: UPDATE_SCHEMA_VERSION,
        generatedAt: string(index.generated_at, 'generated_at', 64),
        channels: Object.freeze(normalizedChannels),
        revoked: Object.freeze([...new Set(revoked)]),
    });
}

function artifact(value, name, expectedAsset) {
    const item = object(value, name);
    const asset = string(item.asset, `${name}.asset`, 180);
    if (expectedAsset && asset !== expectedAsset)
        throw new Error(`${name}.asset is unexpected`);
    if (!Number.isSafeInteger(item.size) || item.size <= 0 || item.size > 512 * 1024 * 1024)
        throw new Error(`${name}.size is invalid`);
    if (!SHA256.test(item.sha256 ?? ''))
        throw new Error(`${name}.sha256 is invalid`);
    return Object.freeze({
        asset,
        url: httpsUrl(item.url, `${name}.url`),
        sha256: item.sha256.toLowerCase(),
        size: item.size,
    });
}

export function validateUpdateManifest(value) {
    const manifest = object(value, 'update manifest');
    if (manifest.schema_version !== UPDATE_SCHEMA_VERSION)
        throw new Error('unsupported update-manifest schema');
    if (manifest.product !== UPDATE_PRODUCT)
        throw new Error('update manifest is for another product');
    const version = string(manifest.version, 'version', 128);
    const channel = string(manifest.channel, 'channel', 24);
    if (!parseSemver(version) || !UPDATE_CHANNELS.includes(channel) ||
        versionChannel(version) !== channel)
        throw new Error('version and channel are inconsistent');
    if (typeof manifest.revoked !== 'boolean')
        throw new Error('revoked must be boolean');
    const minimumUpdaterVersion = string(
        manifest.minimum_updater_version,
        'minimum_updater_version',
        128
    );
    if (!parseSemver(minimumUpdaterVersion))
        throw new Error('minimum_updater_version is invalid');
    const source = object(manifest.source, 'source');
    if (!COMMIT.test(source.linux_commit ?? '') || !COMMIT.test(source.windows_commit ?? ''))
        throw new Error('source commits are invalid');
    const platforms = object(manifest.platforms, 'platforms');
    const linux = object(platforms.linux, 'platforms.linux');
    const windows = object(platforms.windows, 'platforms.windows');
    const linuxArtifact = artifact(
        linux,
        'platforms.linux',
        'ShadowokxPanel-Linux.zip'
    );
    const windowsInstaller = artifact(
        windows.installer,
        'platforms.windows.installer',
        'ShadowokxPanel-Setup-x64.exe'
    );
    const windowsPortable = artifact(
        windows.portable,
        'platforms.windows.portable',
        'ShadowokxPanel-Portable-x64.zip'
    );
    if (linux.uuid !== 'shadow-panel@shadowokx' ||
        !Number.isInteger(linux.gnome_shell_minimum) ||
        !Number.isInteger(linux.gnome_shell_maximum) ||
        linux.gnome_shell_minimum > linux.gnome_shell_maximum)
        throw new Error('Linux compatibility is invalid');
    const rollout = manifest.rollout ?? 100;
    if (!Number.isInteger(rollout) || rollout < 0 || rollout > 100)
        throw new Error('rollout is invalid');
    return Object.freeze({
        schemaVersion: UPDATE_SCHEMA_VERSION,
        product: UPDATE_PRODUCT,
        version,
        channel,
        publishedAt: string(manifest.published_at, 'published_at', 64),
        revoked: manifest.revoked,
        minimumUpdaterVersion,
        releaseNotesUrl: manifest.release_notes_url
            ? httpsUrl(manifest.release_notes_url, 'release_notes_url')
            : null,
        rollout,
        source: Object.freeze({
            linuxCommit: source.linux_commit.toLowerCase(),
            windowsCommit: source.windows_commit.toLowerCase(),
            workflowRunId: String(source.workflow_run_id ?? ''),
            builtAt: string(source.built_at, 'source.built_at', 64),
        }),
        platforms: Object.freeze({
            linux: Object.freeze({
                ...linuxArtifact,
                uuid: linux.uuid,
                gnomeShellMinimum: linux.gnome_shell_minimum,
                gnomeShellMaximum: linux.gnome_shell_maximum,
            }),
            windows: Object.freeze({
                installer: windowsInstaller,
                portable: windowsPortable,
                minimumOs: string(windows.minimum_os, 'platforms.windows.minimum_os', 64),
                architecture: string(windows.architecture, 'platforms.windows.architecture', 32),
            }),
        }),
    });
}

export function eligibleChannelReferences(index, selectedChannel) {
    const names = selectedChannel === 'stable'
        ? ['stable']
        : selectedChannel === 'beta'
            ? ['stable', 'beta']
            : ['stable', 'beta', 'developer'];
    return names.map(name => ({channel: name, ...index.channels[name]}))
        .filter(reference => reference.version && reference.rollout === 100)
        .sort((left, right) => compareSemver(right.version, left.version));
}

export function selectUpdate({
    index,
    manifests,
    currentVersion,
    selectedChannel,
    updaterVersion,
    platform,
    compatibility,
}) {
    for (const reference of eligibleChannelReferences(index, selectedChannel)) {
        const manifest = manifests.get(reference.version);
        if (!manifest || manifest.version !== reference.version ||
            manifest.channel !== reference.channel)
            continue;
        if (manifest.revoked || index.revoked.includes(manifest.version) ||
            !canUpgrade(currentVersion, selectedChannel, manifest.version, manifest.channel) ||
            compareSemver(updaterVersion, manifest.minimumUpdaterVersion) < 0 ||
            !manifest.platforms[platform] || !compatibility(manifest.platforms[platform]))
            continue;
        return Object.freeze({
            manifest,
            important: index.revoked.includes(currentVersion),
        });
    }
    return null;
}

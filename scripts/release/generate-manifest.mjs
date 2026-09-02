#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function argumentsMap(values) {
    const result = new Map();
    for (let index = 0; index < values.length; index += 2) {
        if (!values[index]?.startsWith('--') || values[index + 1] === undefined)
            throw new Error(`invalid argument near ${values[index] ?? '<end>'}`);
        result.set(values[index].slice(2), values[index + 1]);
    }
    return result;
}

function required(args, name) {
    const value = args.get(name);
    if (!value)
        throw new Error(`--${name} is required`);
    return value;
}

function fileMetadata(directory, asset, releaseBase) {
    const location = path.join(directory, asset);
    const contents = fs.readFileSync(location);
    return {
        asset,
        url: `${releaseBase}/${encodeURIComponent(asset)}`,
        sha256: crypto.createHash('sha256').update(contents).digest('hex'),
        size: contents.length,
    };
}

try {
    const args = argumentsMap(process.argv.slice(2));
    const directory = path.resolve(required(args, 'directory'));
    const version = required(args, 'version');
    const channel = required(args, 'channel');
    const repository = required(args, 'repository');
    const tag = required(args, 'tag');
    const publishedAt = required(args, 'published-at');
    const builtAt = required(args, 'built-at');
    const releaseBase = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}`;
    const linux = fileMetadata(directory, 'ShadowokxPanel-Linux.zip', releaseBase);
    const installer = fileMetadata(directory, 'ShadowokxPanel-Setup-x64.exe', releaseBase);
    const portable = fileMetadata(directory, 'ShadowokxPanel-Portable-x64.zip', releaseBase);
    const manifest = {
        schema_version: 1,
        product: 'shadowokx-panel',
        version,
        channel,
        published_at: publishedAt,
        revoked: false,
        minimum_updater_version: '2.3.3',
        release_notes_url: `https://github.com/${repository}/releases/tag/${encodeURIComponent(tag)}`,
        rollout: 100,
        source: {
            linux_commit: required(args, 'linux-commit'),
            windows_commit: required(args, 'windows-commit'),
            workflow_run_id: required(args, 'workflow-run-id'),
            built_at: builtAt,
        },
        platforms: {
            linux: {
                ...linux,
                uuid: 'shadow-panel@shadowokx',
                gnome_shell_minimum: 50,
                gnome_shell_maximum: 50,
            },
            windows: {
                architecture: 'x64',
                minimum_os: '10.0.22000',
                installer,
                portable,
                authenticode: {required: false, publisher: null},
            },
        },
        manifest_signing: {
            algorithm: null,
            key_id: null,
            signature: null,
        },
    };
    fs.writeFileSync(path.join(directory, 'update.json'),
        `${JSON.stringify(manifest, null, 2)}\n`);
    const artifacts = [linux, installer, portable];
    const checksums = artifacts.map(item => `${item.sha256}  ${item.asset}`).join('\n');
    fs.writeFileSync(path.join(directory, 'checksums.txt'), `${checksums}\n`);
} catch (error) {
    console.error(`Manifest generation failed: ${error.message}`);
    process.exit(1);
}

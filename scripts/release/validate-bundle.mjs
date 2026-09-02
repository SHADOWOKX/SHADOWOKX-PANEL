#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

import {validateUpdateManifest} from '../../services/update/manifest.js';

function digest(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function archiveEntries(file) {
    return execFileSync('unzip', ['-Z1', file], {encoding: 'utf8'})
        .split(/\r?\n/).filter(Boolean);
}

function safeEntries(entries, name) {
    if (entries.length === 0 || entries.some(entry =>
        entry.startsWith('/') || entry.includes('\\') ||
        entry.split('/').some(part => part === '..'))) {
        throw new Error(`${name} contains an unsafe archive path`);
    }
}

try {
    const directory = path.resolve(process.argv[2] ?? '');
    const manifest = validateUpdateManifest(JSON.parse(
        fs.readFileSync(path.join(directory, 'update.json'), 'utf8')
    ));
    const expected = [
        manifest.platforms.linux,
        manifest.platforms.windows.installer,
        manifest.platforms.windows.portable,
    ];
    for (const artifact of expected) {
        const location = path.join(directory, artifact.asset);
        const stats = fs.statSync(location);
        if (!stats.isFile() || stats.size !== artifact.size || digest(location) !== artifact.sha256)
            throw new Error(`${artifact.asset} does not match update.json`);
    }
    const checksums = fs.readFileSync(path.join(directory, 'checksums.txt'), 'utf8')
        .trim().split(/\r?\n/);
    for (const artifact of expected) {
        if (!checksums.includes(`${artifact.sha256}  ${artifact.asset}`))
            throw new Error(`checksums.txt is missing ${artifact.asset}`);
    }
    const linuxEntries = archiveEntries(path.join(directory, manifest.platforms.linux.asset));
    safeEntries(linuxEntries, 'Linux package');
    for (const required of ['metadata.json', 'extension.js', 'stylesheet.css', 'VERSION',
        'update-helper.py']) {
        if (!linuxEntries.includes(required))
            throw new Error(`Linux package is missing ${required}`);
    }
    const metadata = JSON.parse(execFileSync('unzip', [
        '-p',
        path.join(directory, manifest.platforms.linux.asset),
        'metadata.json',
    ], {encoding: 'utf8'}));
    if (metadata.uuid !== manifest.platforms.linux.uuid ||
        metadata['version-name'] !== manifest.version)
        throw new Error('Linux package identity/version does not match the manifest');
    const portableEntries = archiveEntries(
        path.join(directory, manifest.platforms.windows.portable.asset)
    );
    safeEntries(portableEntries, 'Windows portable package');
    for (const required of ['ShadowokxPanel.exe', 'ShadowokxPanel.pri', 'App.xbf',
        'MainWindow.xbf', 'SettingsWindow.xbf']) {
        if (!portableEntries.some(entry => entry.endsWith(required)))
            throw new Error(`Windows portable package is missing ${required}`);
    }
    if (portableEntries.some(entry => entry.toLowerCase().endsWith('.pdb')))
        throw new Error('Windows portable package contains developer symbols');
    process.stdout.write(`Validated release bundle ${manifest.version} (${manifest.channel})\n`);
} catch (error) {
    console.error(`Release bundle validation failed: ${error.message}`);
    process.exit(1);
}

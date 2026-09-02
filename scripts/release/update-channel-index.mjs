#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const SEMVER = /^\d+\.\d+\.\d+(?:-(?:beta|dev)\.\d+)?$/;

function load(file) {
    if (!fs.existsSync(file)) {
        return {
            schema_version: 1,
            generated_at: new Date(0).toISOString(),
            channels: {stable: null, beta: null, developer: null},
            revoked: [],
        };
    }
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value.schema_version !== 1 || !value.channels || !Array.isArray(value.revoked))
        throw new Error('existing channels.json is invalid');
    return value;
}

try {
    const [fileArgument, action, channel, version, manifestUrl, publishedAt] =
        process.argv.slice(2);
    const file = path.resolve(fileArgument ?? 'channels.json');
    if (!SEMVER.test(version ?? ''))
        throw new Error('version is invalid');
    const index = load(file);
    if (action === 'publish') {
        if (!['stable', 'beta', 'developer'].includes(channel))
            throw new Error('channel is invalid');
        if (!manifestUrl?.startsWith('https://'))
            throw new Error('manifest URL must use HTTPS');
        index.channels[channel] = {
            version,
            manifest_url: manifestUrl,
            published_at: publishedAt,
            rollout: 100,
        };
        index.revoked = index.revoked.filter(item => item !== version);
    } else if (action === 'revoke') {
        if (!index.revoked.includes(version))
            index.revoked.push(version);
        for (const name of ['stable', 'beta', 'developer']) {
            if (index.channels[name]?.version === version)
                index.channels[name] = null;
        }
    } else {
        throw new Error('action must be publish or revoke');
    }
    index.generated_at = new Date().toISOString();
    index.revoked.sort();
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, `${JSON.stringify(index, null, 2)}\n`);
} catch (error) {
    console.error(`Channel-index update failed: ${error.message}`);
    process.exit(1);
}

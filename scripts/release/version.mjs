#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:beta|dev)\.(?:0|[1-9]\d*)))?$/;

function read(file) {
    return fs.readFileSync(file, 'utf8');
}

function write(file, value) {
    fs.writeFileSync(file, value, 'utf8');
}

function parse(value) {
    const match = SEMVER.exec(value.trim());
    if (!match)
        throw new Error(`unsupported product version: ${value}`);
    return {
        value: value.trim(),
        base: `${match[1]}.${match[2]}.${match[3]}`,
        channel: match[4]?.startsWith('beta.')
            ? 'beta'
            : match[4]?.startsWith('dev.') ? 'developer' : 'stable',
    };
}

function files(root) {
    return {
        version: path.join(root, 'VERSION'),
        package: path.join(root, 'package.json'),
        metadata: path.join(root, 'metadata.json'),
        readme: path.join(root, 'README.md'),
    };
}

function check(root) {
    const locations = files(root);
    const canonical = parse(read(locations.version));
    if (fs.existsSync(locations.package)) {
        const packageMetadata = JSON.parse(read(locations.package));
        if (packageMetadata.version !== canonical.value)
            throw new Error('package.json version differs from VERSION');
    }
    if (fs.existsSync(locations.metadata)) {
        const metadata = JSON.parse(read(locations.metadata));
        if (Object.hasOwn(metadata, 'version-name') &&
            metadata['version-name'] !== canonical.value)
            throw new Error('metadata.json version-name differs from VERSION');
    }
    return canonical;
}

function setVersion(root, requested) {
    const locations = files(root);
    const target = parse(requested);
    const source = parse(read(locations.version));
    if (source.base !== target.base)
        throw new Error(`requested ${target.value} does not match source base ${source.base}`);
    write(locations.version, `${target.value}\n`);
    if (fs.existsSync(locations.package)) {
        const packageMetadata = JSON.parse(read(locations.package));
        packageMetadata.version = target.value;
        write(locations.package, `${JSON.stringify(packageMetadata, null, 2)}\n`);
    }
    if (fs.existsSync(locations.metadata)) {
        const metadata = JSON.parse(read(locations.metadata));
        if (Object.hasOwn(metadata, 'version-name')) {
            metadata['version-name'] = target.value;
            write(locations.metadata, `${JSON.stringify(metadata, null, 2)}\n`);
        }
    }
    if (fs.existsSync(locations.readme)) {
        const contents = read(locations.readme);
        if (/Release `[^`]+`/.test(contents)) {
            const replaced = contents.replace(
                /Release `[^`]+`/,
                `Release \`${target.value}\``
            );
            write(locations.readme, replaced);
        }
    }
    check(root);
    return target;
}

const [command, rootArgument = '.', versionArgument, channelArgument] = process.argv.slice(2);
const root = path.resolve(rootArgument);
try {
    if (command === 'check') {
        const current = check(root);
        process.stdout.write(`${JSON.stringify(current)}\n`);
    } else if (command === 'assert') {
        const current = check(root);
        const requested = parse(versionArgument ?? '');
        if (current.base !== requested.base || requested.channel !== channelArgument)
            throw new Error('release version/channel does not match the source VERSION');
    } else if (command === 'set') {
        const target = setVersion(root, versionArgument ?? '');
        process.stdout.write(`${JSON.stringify(target)}\n`);
    } else {
        throw new Error('usage: version.mjs check ROOT | assert ROOT VERSION CHANNEL | set ROOT VERSION');
    }
} catch (error) {
    console.error(`Version validation failed: ${error.message}`);
    process.exit(1);
}

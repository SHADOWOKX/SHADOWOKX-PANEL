const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PRODUCT_PRERELEASE_RANK = Object.freeze({
    nightly: 0,
    dev: 1,
    alpha: 2,
    beta: 3,
    rc: 4,
});

export function parseSemver(value) {
    if (typeof value !== 'string')
        return null;
    const match = SEMVER_PATTERN.exec(value.trim());
    if (!match)
        return null;
    const prerelease = match[4]?.split('.') ?? [];
    if (prerelease.some(identifier => /^\d+$/.test(identifier) &&
        identifier.length > 1 && identifier.startsWith('0')))
        return null;
    return Object.freeze({
        raw: value.trim(),
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: Object.freeze(prerelease),
    });
}

function compareIdentifiers(left, right) {
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric)
        return Number(left) - Number(right);
    if (leftNumeric !== rightNumeric)
        return leftNumeric ? -1 : 1;
    const leftRank = PRODUCT_PRERELEASE_RANK[left.toLowerCase()];
    const rightRank = PRODUCT_PRERELEASE_RANK[right.toLowerCase()];
    if (leftRank !== undefined && rightRank !== undefined && leftRank !== rightRank)
        return leftRank - rightRank;
    return left.localeCompare(right);
}

export function compareSemver(leftValue, rightValue) {
    const left = typeof leftValue === 'string' ? parseSemver(leftValue) : leftValue;
    const right = typeof rightValue === 'string' ? parseSemver(rightValue) : rightValue;
    if (!left || !right)
        throw new Error('Cannot compare invalid semantic versions');
    for (const field of ['major', 'minor', 'patch']) {
        if (left[field] !== right[field])
            return left[field] < right[field] ? -1 : 1;
    }
    if (left.prerelease.length === 0 || right.prerelease.length === 0) {
        if (left.prerelease.length === right.prerelease.length)
            return 0;
        return left.prerelease.length === 0 ? 1 : -1;
    }
    const count = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < count; index++) {
        if (left.prerelease[index] === undefined)
            return -1;
        if (right.prerelease[index] === undefined)
            return 1;
        const result = compareIdentifiers(left.prerelease[index], right.prerelease[index]);
        if (result !== 0)
            return result < 0 ? -1 : 1;
    }
    return 0;
}

export function versionChannel(version) {
    const parsed = typeof version === 'string' ? parseSemver(version) : version;
    if (!parsed)
        return null;
    if (parsed.prerelease.length === 0)
        return 'stable';
    const label = parsed.prerelease[0].toLowerCase();
    if (label === 'beta' || label === 'rc')
        return 'beta';
    if (label === 'dev' || label === 'alpha' || label === 'nightly')
        return 'developer';
    return null;
}

export function channelAllows(selectedChannel, candidateChannel) {
    if (selectedChannel === 'stable')
        return candidateChannel === 'stable';
    if (selectedChannel === 'beta')
        return candidateChannel === 'stable' || candidateChannel === 'beta';
    return selectedChannel === 'developer' &&
        ['stable', 'beta', 'developer'].includes(candidateChannel);
}

export function canUpgrade(currentVersion, selectedChannel, candidateVersion, candidateChannel) {
    const actualChannel = candidateChannel ?? versionChannel(candidateVersion);
    return Boolean(
        parseSemver(currentVersion) &&
        parseSemver(candidateVersion) &&
        channelAllows(selectedChannel, actualChannel) &&
        compareSemver(candidateVersion, currentVersion) > 0
    );
}

export function baseVersion(version) {
    const parsed = parseSemver(version);
    return parsed ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : null;
}

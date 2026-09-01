export function progressFillGeometry(percent, trackWidth, startInset = 0, endInset = 0) {
    const number = Number(percent);
    const value = Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
    const width = Number.isFinite(trackWidth) ? Math.max(0, trackWidth) : 0;
    const start = Number.isFinite(startInset) ? Math.max(0, startInset) : 0;
    const end = Number.isFinite(endInset) ? Math.max(0, endInset) : 0;
    const usableWidth = Math.max(0, width - start - end);
    return {
        value,
        start,
        usableWidth,
        fillWidth: Math.round(usableWidth * value / 100),
    };
}

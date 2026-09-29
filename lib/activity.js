const DAY_MS = 86_400_000;

export function accountActivityCalendar(buckets, today) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? ''))
        return {cells: [], months: [], columns: 0, reportedDays: 0, activeDays: 0, peak: null};
    const end = Date.parse(`${today}T00:00:00Z`);
    if (!Number.isFinite(end) || new Date(end).toISOString().slice(0, 10) !== today)
        return accountActivityCalendar([], null);
    const date = new Date(end);
    const start = Date.UTC(date.getUTCFullYear() - 1, date.getUTCMonth() + 1, 1);
    const gridStart = start - new Date(start).getUTCDay() * DAY_MS;
    const columns = Math.ceil(((end - gridStart) / DAY_MS + 1) / 7);
    const byDate = new Map();
    for (const bucket of buckets ?? []) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(bucket?.date ?? '') &&
            Number.isSafeInteger(bucket.tokens) && bucket.tokens >= 0)
            byDate.set(bucket.date, bucket.tokens);
    }
    const cells = [];
    const months = [];
    let peak = null;
    let activeDays = 0;
    let reportedDays = 0;
    for (let index = 0; index < columns * 7; index++) {
        const timestamp = gridStart + index * DAY_MS;
        const key = new Date(timestamp).toISOString().slice(0, 10);
        const inRange = timestamp >= start && timestamp <= end;
        const tokens = inRange && byDate.has(key) ? byDate.get(key) : null;
        const cell = {date: key, tokens, inRange, column: Math.floor(index / 7), row: index % 7};
        cells.push(cell);
        if (inRange && tokens !== null) {
            reportedDays++;
            if (tokens > 0)
                activeDays++;
            if (!peak || tokens > peak.tokens)
                peak = cell;
        }
        if (inRange && key.endsWith('-01'))
            months.push({date: key, column: cell.column,
                label: new Date(timestamp).toLocaleDateString('en-US', {month: 'short', timeZone: 'UTC'})});
    }
    return {cells, months, columns, rows: 7, mode: 'daily', reportedDays, activeDays, peak};
}

// Each weekly cell sums only account dates that were actually returned.
// Coverage travels with the value, so an incomplete week is never presented as complete.
export function weeklyAccountActivity(calendar) {
    const cells = [];
    for (let column = 0; column < calendar.columns; column++) {
        const days = calendar.cells.filter(cell => cell.column === column && cell.inRange);
        if (!days.length)
            continue;
        const reported = days.filter(cell => cell.tokens !== null);
        const tokens = reported.length ? reported.reduce((sum, cell) => sum + cell.tokens, 0) : null;
        cells.push({date: days[0].date, endDate: days.at(-1).date,
            tokens: Number.isSafeInteger(tokens) ? tokens : null,
            reportedDays: reported.length, expectedDays: days.length,
            inRange: true, column: Math.floor(cells.length / 4), row: cells.length % 4});
    }
    const peak = cells.filter(cell => cell.tokens !== null)
        .reduce((best, cell) => !best || cell.tokens > best.tokens ? cell : best, null);
    const bounds = [cells[0]?.date, cells.at(-1)?.endDate].filter(Boolean);
    const months = bounds.map(date => ({date, label: new Date(`${date}T00:00:00Z`)
        .toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'})}));
    return {cells, months, columns: Math.ceil(cells.length / 4), rows: 4,
        mode: 'weekly', reportedDays: calendar.reportedDays,
        activeDays: cells.filter(cell => cell.tokens > 0).length, peak};
}

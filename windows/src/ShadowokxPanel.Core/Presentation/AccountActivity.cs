using ShadowokxPanel.Core.Models;

namespace ShadowokxPanel.Core.Presentation;

public sealed record ActivityCell(DateOnly Date, DateOnly EndDate, long? Tokens,
    int Column, int Row, int ReportedDays, int ExpectedDays);
public sealed record ActivityCalendar(IReadOnlyList<ActivityCell> Cells, int Columns, int Rows,
    DateOnly Start, DateOnly End, bool Weekly)
{
    public ActivityCell? Peak => Cells.Where(cell => cell.Tokens.HasValue)
        .OrderByDescending(cell => cell.Tokens).FirstOrDefault();
    public int ActiveCount => Cells.Count(cell => cell.Tokens > 0);
}

public static class AccountActivity
{
    public static ActivityCalendar Create(IEnumerable<UsageBucket>? buckets, DateOnly today, bool weekly)
    {
        var first = new DateOnly(today.Year, today.Month, 1).AddMonths(-11);
        var start = first.AddDays(-(int)first.DayOfWeek);
        var source = (buckets ?? []).Where(bucket => bucket.Tokens >= 0)
            .GroupBy(bucket => bucket.Date).ToDictionary(group => group.Key, group => group.Last().Tokens);
        var columns = (today.DayNumber - start.DayNumber + 7) / 7;
        var cells = new List<ActivityCell>();
        for (var column = 0; column < columns; column++)
        {
            var days = new List<ActivityCell>();
            for (var row = 0; row < 7; row++)
            {
                var date = start.AddDays(column * 7 + row);
                if (date < first || date > today) continue;
                long? tokens = source.TryGetValue(date, out var value) ? value : null;
                days.Add(new(date, date, tokens, column, row, tokens.HasValue ? 1 : 0, 1));
            }
            if (!weekly) { cells.AddRange(days); continue; }
            if (days.Count == 0) continue;
            var reported = days.Where(day => day.Tokens.HasValue).ToArray();
            long? sum = null;
            try { if (reported.Length > 0) sum = reported.Sum(day => day.Tokens!.Value); }
            catch (OverflowException) { }
            var index = cells.Count;
            cells.Add(new(days[0].Date, days[^1].Date, sum, index / 4, index % 4, reported.Length, days.Count));
        }
        return new(cells, weekly ? (cells.Count + 3) / 4 : columns, weekly ? 4 : 7, first, today, weekly);
    }
}

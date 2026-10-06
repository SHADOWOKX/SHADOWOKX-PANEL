using ShadowokxPanel.Core.AI;

namespace ShadowokxPanel.Core.Presentation;

// Single source of truth for the "remaining allowance" percentage that both the
// panel, the tray icon, and the taskbar widget display. No surface may compute its
// own value.
public static class AllowanceValue
{
    public static int? Normalize(double? remaining) =>
        remaining is { } value && double.IsFinite(value)
            ? (int)Math.Clamp(Math.Round(value, MidpointRounding.AwayFromZero), 0, 100)
            : null;

    // Codex reports remaining percentages directly; weekly wins over the 5-hour window.
    public static int? Codex(double? weeklyRemaining, double? fiveHourRemaining) =>
        Normalize(weeklyRemaining ?? fiveHourRemaining);

    // Non-Codex providers report a used percentage on their active windows.
    public static int? Provider(AIUsage? usage, DateTimeOffset? now = null)
    {
        if (usage is null)
            return null;
        var at = now ?? DateTimeOffset.UtcNow;
        foreach (var window in usage.Windows)
        {
            if (window.ResetsAt is { } reset && reset <= at)
                continue;
            var remaining = AllowanceStatus.Remaining(window.UsedPercent);
            if (remaining is not null)
                return Normalize(remaining);
        }
        return null;
    }
}

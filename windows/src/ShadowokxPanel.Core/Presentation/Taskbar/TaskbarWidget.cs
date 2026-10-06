namespace ShadowokxPanel.Core.Presentation.Taskbar;

// Hybrid taskbar-widget modes. Auto resolves at runtime from the compatibility
// verdict; Integrated is only ever used when a reserved slot is genuinely available.
public enum TaskbarWidgetMode
{
    Auto,
    Integrated,
    Overlay,
}

// SUPPORTED  a safe, validated mechanism to reserve real taskbar space exists
// UNKNOWN    the taskbar tree could not be validated (treat as overlay)
// UNSUPPORTED no safe public mechanism exists on this Windows build
public enum TaskbarIntegrationState
{
    Supported,
    Unknown,
    Unsupported,
}

public enum TaskbarResolvedMode
{
    Integrated,
    Overlay,
}

public sealed record TaskbarCompatibility(TaskbarIntegrationState State, string Reason)
{
    public static TaskbarCompatibility Supported(string reason) => new(TaskbarIntegrationState.Supported, reason);
    public static TaskbarCompatibility Unknown(string reason) => new(TaskbarIntegrationState.Unknown, reason);
    public static TaskbarCompatibility Unsupported(string reason) => new(TaskbarIntegrationState.Unsupported, reason);

    public bool CanReserveSpace => State == TaskbarIntegrationState.Supported;
}

// Pure arithmetic for the overlay/reserved widget rectangle. All values are physical
// pixels: taskbar geometry, DPI-scaled content sizes, and screen coordinates.
public static class TaskbarWidgetGeometry
{
    // Gap from the taskbar's left edge and internal padding.
    public const int LeftMarginPx = 4;

    public static int Scaled(double dip, double scale)
    {
        var safeScale = double.IsFinite(scale) ? Math.Clamp(scale, 0.5, 8) : 1;
        var safeDip = double.IsFinite(dip) ? Math.Max(0, dip) : 0;
        return (int)Math.Round(safeDip * safeScale, MidpointRounding.AwayFromZero);
    }

    // The mascot is sized from the real taskbar height, never a fixed 48 px.
    public static int MascotSize(int taskbarHeightPx)
    {
        if (taskbarHeightPx <= 0) return 16;
        return Math.Clamp((int)Math.Round(taskbarHeightPx * 0.58, MidpointRounding.AwayFromZero), 14, 40);
    }

    public static int WidgetHeight(int taskbarHeightPx)
    {
        var mascot = MascotSize(taskbarHeightPx);
        var padding = Scaled(3, 1);
        return Math.Clamp(mascot + padding * 2, 1, Math.Max(1, taskbarHeightPx));
    }

    public static int ContentWidth(int mascotPx, int textWidthPx, int paddingPx, int gapPx) =>
        Math.Max(1, paddingPx * 2 + mascotPx + gapPx + Math.Max(0, textWidthPx));

    // Extreme-left placement, vertically centered inside the taskbar.
    public static ScreenRect Place(ScreenRect taskbar, int contentWidthPx, int heightPx)
    {
        var height = Math.Clamp(heightPx, 1, Math.Max(1, taskbar.Height));
        var width = Math.Max(1, contentWidthPx);
        var y = taskbar.Y + Math.Max(0, (taskbar.Height - height) / 2);
        var x = taskbar.X + LeftMarginPx;
        return new ScreenRect(x, y, width, height);
    }

    // Never draw when the shell would not.
    public static bool ShouldShow(bool enabled, bool taskbarPresent, bool taskbarHidden,
        bool autoHideSuppressed, bool fullscreenOccluded) =>
        enabled && taskbarPresent && !taskbarHidden && !autoHideSuppressed && !fullscreenOccluded;

    // Fail-safe mode selection: anything other than a validated SUPPORTED build uses
    // the overlay. Requesting Integrated on an unsupported build still yields overlay.
    public static TaskbarResolvedMode Resolve(TaskbarWidgetMode requested, TaskbarIntegrationState state) =>
        requested switch
        {
            TaskbarWidgetMode.Overlay => TaskbarResolvedMode.Overlay,
            TaskbarWidgetMode.Integrated when state == TaskbarIntegrationState.Supported => TaskbarResolvedMode.Integrated,
            TaskbarWidgetMode.Integrated => TaskbarResolvedMode.Overlay,
            _ => state == TaskbarIntegrationState.Supported ? TaskbarResolvedMode.Integrated : TaskbarResolvedMode.Overlay,
        };
}

// The values the widget renders. Busy is task-only; it is never derived from window
// or process presence.
public sealed record TaskbarWidgetState(bool Busy, int? RemainingPercent, string ProviderId, string ProviderName)
{
    public static TaskbarWidgetState From(bool codexBusy, bool commandCodeBusy, int? remaining, string providerId, string providerName) =>
        new(codexBusy || commandCodeBusy, remaining, providerId, providerName);
}

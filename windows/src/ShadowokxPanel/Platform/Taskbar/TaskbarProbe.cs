using ShadowokxPanel.Core.Presentation;
using ShadowokxPanel.Core.Presentation.Taskbar;

namespace ShadowokxPanel.Platform.Taskbar;

internal enum TaskbarEdge { Bottom, Top, Left, Right, Unknown }

// A snapshot of the real shell state, queried on demand and on shell events.
internal sealed record TaskbarSnapshot(
    bool Present,
    nint TaskbarHandle,
    ScreenRect Taskbar,
    ScreenRect Monitor,
    int Dpi,
    double Scale,
    TaskbarEdge Edge,
    bool AutoHide,
    bool Retracted,
    bool FullscreenOccluded)
{
    internal static readonly TaskbarSnapshot Missing = new(false, 0, new ScreenRect(0, 0, 0, 0),
        new ScreenRect(0, 0, 0, 0), 96, 1, TaskbarEdge.Unknown, false, false, false);
}

// Public-API-only probe of the Windows shell taskbar. Used both to validate whether
// an integrated slot is possible and to place the overlay.
internal static class TaskbarProbe
{
    internal static TaskbarSnapshot Capture()
    {
        if (!OperatingSystem.IsWindows())
            return TaskbarSnapshot.Missing;

        var handle = TaskbarInterop.FindWindow("Shell_TrayWnd", null);
        if (handle == 0 || !TaskbarInterop.IsWindow(handle))
            return TaskbarSnapshot.Missing;
        return Capture(handle);
    }

    internal static TaskbarSnapshot Capture(nint handle)
    {
        if (handle == 0 || !TaskbarInterop.GetWindowRect(handle, out var rect))
            return TaskbarSnapshot.Missing;

        var taskbar = new ScreenRect(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top);
        var monitor = CaptureMonitor(handle, taskbar);
        var dpi = (int)Math.Max(96, NativeMethods.GetDpiForWindow(handle));
        var scale = dpi / 96d;
        var edge = EdgeOf(taskbar, monitor);
        var autoHide = QueryAutoHide(handle);
        var retracted = IsRetracted(taskbar, monitor, edge);
        var occluded = IsFullscreenOccluded(handle);
        return new TaskbarSnapshot(true, handle, taskbar, monitor, dpi, scale, edge, autoHide, retracted, occluded);
    }

    private static ScreenRect CaptureMonitor(nint handle, ScreenRect fallback)
    {
        var monitorHandle = TaskbarInterop.MonitorFromWindow(handle, TaskbarInterop.MonitorDefaultToNearest);
        if (monitorHandle == 0)
            return fallback;
        var info = new NativeMethods.MonitorInfo
        {
            cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf<NativeMethods.MonitorInfo>(),
        };
        if (!NativeMethods.GetMonitorInfo(monitorHandle, ref info))
            return fallback;
        return new ScreenRect(info.rcMonitor.Left, info.rcMonitor.Top,
            info.rcMonitor.Right - info.rcMonitor.Left, info.rcMonitor.Bottom - info.rcMonitor.Top);
    }

    private static bool QueryAutoHide(nint handle)
    {
        var data = new TaskbarInterop.AppBarData
        {
            cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf<TaskbarInterop.AppBarData>(),
            hWnd = handle,
        };
        var state = TaskbarInterop.SHAppBarMessage(TaskbarInterop.AbdGetState, ref data);
        return (state.ToInt64() & TaskbarInterop.AbsAutohide) != 0;
    }

    internal static TaskbarEdge EdgeOf(ScreenRect taskbar, ScreenRect monitor)
    {
        if (taskbar.Width <= 0 || taskbar.Height <= 0)
            return TaskbarEdge.Unknown;
        // Horizontal bars are recognized by their thickness vs the monitor.
        var horizontal = taskbar.Width >= taskbar.Height;
        if (horizontal)
        {
            var center = taskbar.Y + taskbar.Height / 2;
            return center <= monitor.Y + monitor.Height / 2 ? TaskbarEdge.Top : TaskbarEdge.Bottom;
        }
        return taskbar.X + taskbar.Width / 2 <= monitor.X + monitor.Width / 2 ? TaskbarEdge.Left : TaskbarEdge.Right;
    }

    // A retracted (auto-hidden) taskbar is slid almost entirely off its edge.
    internal static bool IsRetracted(ScreenRect taskbar, ScreenRect monitor, TaskbarEdge edge)
    {
        const int tolerance = 4;
        return edge switch
        {
            TaskbarEdge.Bottom => taskbar.Y >= monitor.Bottom - tolerance,
            TaskbarEdge.Top => taskbar.Bottom <= monitor.Y + tolerance,
            TaskbarEdge.Left => taskbar.Right <= monitor.X + tolerance,
            TaskbarEdge.Right => taskbar.X >= monitor.Right - tolerance,
            _ => false,
        };
    }

    private static bool IsFullscreenOccluded(nint handle)
    {
        // Documented shell state: D3D fullscreen / presentation mode suppress chrome.
        if (TaskbarInterop.SHQueryUserNotificationState(out var state) == 0 &&
            state is TaskbarInterop.QunsBusy or TaskbarInterop.QunsRunningD3dFullScreen or TaskbarInterop.QunsPresentationMode)
            return true;

        // Borderless-windowed fullscreen: the foreground window covers the whole monitor.
        var foreground = TaskbarInterop.GetForegroundWindow();
        if (foreground == 0 || foreground == handle)
            return false;
        var monitorHandle = TaskbarInterop.MonitorFromWindow(handle, TaskbarInterop.MonitorDefaultToNearest);
        if (monitorHandle != TaskbarInterop.MonitorFromWindow(foreground, TaskbarInterop.MonitorDefaultToNearest))
            return false;
        if (!TaskbarInterop.GetWindowRect(foreground, out var rect))
            return false;
        var monitor = CaptureMonitor(handle, new ScreenRect(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top));
        return rect.Left <= monitor.X && rect.Top <= monitor.Y &&
            rect.Right >= monitor.Right && rect.Bottom >= monitor.Bottom;
    }

    // The compatibility verdict for integrated (reserved) mode. Stock Windows 11 exposes
    // no public mechanism to place an element inside the XAML taskbar or reserve an
    // interior region for it; doing so requires injecting into explorer.exe, which this
    // project deliberately never does. So integrated mode reports UNSUPPORTED here and
    // the widget runs as an overlay. The check is still performed so a future supported
    // mechanism can be added behind this method.
    internal static TaskbarCompatibility EvaluateCompatibility(TaskbarSnapshot snapshot)
    {
        if (!OperatingSystem.IsWindows())
            return TaskbarCompatibility.Unsupported("non-Windows host");
        if (!snapshot.Present)
            return TaskbarCompatibility.Unknown("Shell_TrayWnd not found");
        var build = Environment.OSVersion.Version.Build;
        if (build >= 22000)
            return TaskbarCompatibility.Unsupported(
                $"Windows build {build}: the XAML taskbar has no public API to reserve an in-taskbar region");
        return TaskbarCompatibility.Unsupported(
            $"Windows build {build}: no safe in-taskbar reservation API (DeskBands are unavailable)");
    }
}

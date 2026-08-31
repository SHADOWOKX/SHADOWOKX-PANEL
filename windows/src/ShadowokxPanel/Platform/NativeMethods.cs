using System.Runtime.InteropServices;

[assembly: DefaultDllImportSearchPaths(DllImportSearchPath.System32)]

namespace ShadowokxPanel.Platform;

internal static class NativeMethods
{
    internal const int GwlpWndProc = -4;
    internal const uint WmApp = 0x8000;
    internal const uint WmCommand = 0x0111;
    internal const uint WmContextMenu = 0x007B;
    internal const uint WmLButtonUp = 0x0202;
    internal const uint WmLButtonDblClk = 0x0203;
    internal const uint WmPowerBroadcast = 0x0218;
    internal const int PbtApmResumeAutomatic = 0x0012;
    internal const uint NimAdd = 0x00000000;
    internal const uint NimModify = 0x00000001;
    internal const uint NimDelete = 0x00000002;
    internal const uint NimSetVersion = 0x00000004;
    internal const uint NifMessage = 0x00000001;
    internal const uint NifIcon = 0x00000002;
    internal const uint NifTip = 0x00000004;
    internal const uint NotifyIconVersion4 = 4;
    internal const uint TpmRightButton = 0x0002;
    internal const uint TpmReturnCmd = 0x0100;
    internal const uint TpmNonotify = 0x0080;
    internal const uint MfString = 0x0000;
    internal const uint MfSeparator = 0x0800;
    internal const uint MfChecked = 0x0008;
    internal const uint MfUnchecked = 0x0000;
    internal const uint MonitorDefaultToNearest = 0x00000002;
    internal const uint SwpNoActivate = 0x0010;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct NotifyIconData
    {
        internal uint cbSize;
        internal nint hWnd;
        internal uint uID;
        internal uint uFlags;
        internal uint uCallbackMessage;
        internal nint hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        internal string szTip;
        internal uint dwState;
        internal uint dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        internal string szInfo;
        internal uint uVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        internal string szInfoTitle;
        internal uint dwInfoFlags;
        internal Guid guidItem;
        internal nint hBalloonIcon;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct Point { internal int X; internal int Y; }

    [StructLayout(LayoutKind.Sequential)]
    internal struct Rect { internal int Left; internal int Top; internal int Right; internal int Bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct MonitorInfo
    {
        internal uint cbSize;
        internal Rect rcMonitor;
        internal Rect rcWork;
        internal uint dwFlags;
    }

    internal delegate nint WindowProcedure(nint hwnd, uint message, nint wParam, nint lParam);

    [DllImport("shell32.dll", EntryPoint = "Shell_NotifyIconW", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ShellNotifyIcon(uint message, ref NotifyIconData data);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    internal static extern nint SetWindowLongPtr(nint hwnd, int index, nint value);

    [DllImport("user32.dll", EntryPoint = "CallWindowProcW")]
    internal static extern nint CallWindowProc(nint previous, nint hwnd, uint message, nint wParam, nint lParam);

    [DllImport("user32.dll", EntryPoint = "RegisterWindowMessageW", CharSet = CharSet.Unicode)]
    internal static extern uint RegisterWindowMessage(string value);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern nint CreatePopupMenu();

    [DllImport("user32.dll", EntryPoint = "AppendMenuW", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool AppendMenu(nint menu, uint flags, nuint id, string? text);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DestroyMenu(nint menu);

    [DllImport("user32.dll")]
    internal static extern uint TrackPopupMenuEx(
        nint menu, uint flags, int x, int y, nint hwnd, nint reserved);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetForegroundWindow(nint hwnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetCursorPos(out Point point);

    [DllImport("user32.dll")]
    internal static extern nint MonitorFromPoint(Point point, uint flags);

    [DllImport("user32.dll", EntryPoint = "GetMonitorInfoW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetMonitorInfo(nint monitor, ref MonitorInfo info);

    [DllImport("user32.dll")]
    internal static extern uint GetDpiForWindow(nint hwnd);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern nint CreateIcon(
        nint instance,
        int width,
        int height,
        byte planes,
        byte bitsPixel,
        byte[] andBits,
        byte[] xorBits);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DestroyIcon(nint icon);
}

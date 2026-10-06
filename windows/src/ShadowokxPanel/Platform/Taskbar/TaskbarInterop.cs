using System.Runtime.InteropServices;

namespace ShadowokxPanel.Platform.Taskbar;

// Minimal, documented Win32 surface for the taskbar companion. Everything here is a
// public OS API (user32 / shell32 / gdi32). No explorer injection, no private exports,
// no memory patching.
internal static class TaskbarInterop
{
    internal const uint WsPopup = 0x80000000;
    internal const uint WsExLayered = 0x00080000;
    internal const uint WsExToolWindow = 0x00000080;
    internal const uint WsExNoActivate = 0x08000000;
    internal const uint WsExTopmost = 0x00000008;
    internal const nint HwndTopmost = -1;
    internal const uint SwpNoActivate = 0x0010;
    internal const uint SwpShowWindow = 0x0040;
    internal const uint SwpNoSize = 0x0001;
    internal const int SwHide = 0;
    internal const int SwShownoactivate = 4;
    internal const uint UlwAlpha = 0x00000002;
    internal const int WmDestroy = 0x0002;
    internal const int WmClose = 0x0010;
    internal const int WmLButtonUp = 0x0202;
    internal const int WmRButtonUp = 0x0205;
    internal const int WmMouseActivate = 0x0021;
    internal const int WmSetcursor = 0x0020;
    internal const int WmDpiChanged = 0x02E0;
    internal const int WmDisplayChange = 0x007E;
    internal const int WmSettingChange = 0x001A;
    internal const int WmTimer = 0x0113;
    internal const int MaNoActivate = 3;
    internal const int IdcArrow = 32512;
    internal const uint ImageIcon = 1;
    internal const uint LrLoadFromFile = 0x0010;
    internal const uint DibRgbColors = 0;
    internal const uint BiRgb = 0;
    internal const int SpiGetNonClientMetrics = 0x0029;
    internal const int LfFaceSize = 32;
    internal const int LfWeight = 16;
    internal const int LfQuality = 24;
    internal const byte DefaultCharSet = 1;
    internal const int FwNormal = 400;
    internal const byte AntialiasedQuality = 4;
    internal const int Transparent = 1;
    internal const int DtLeft = 0x00000000;
    internal const int DtVCenter = 0x00000004;
    internal const int DtSingleLine = 0x00000020;
    internal const int DtNoPrefix = 0x00000800;
    internal const int TmeLeave = 0x00000002;
    internal const int MonitorDefaultToNearest = 2;
    internal const int AbsAutohide = 0x0001;
    internal const int AbdGetState = 0x00000004;
    internal const int AbdGetTaskbarPos = 0x00000005;
    internal const uint EventSystemForeground = 0x0003;
    internal const uint EventObjectLocationChange = 0x800B;
    internal const uint WineventOutOfContext = 0x0000;
    internal const uint WineventSkipOwnProcess = 0x0002;
    // SHQueryUserNotificationState values that mean the shell wants no overlay chrome.
    internal const int QunsBusy = 2;
    internal const int QunsRunningD3dFullScreen = 3;
    internal const int QunsPresentationMode = 4;

    [StructLayout(LayoutKind.Sequential)]
    internal struct AppBarData
    {
        internal uint cbSize;
        internal nint hWnd;
        internal uint uCallbackMessage;
        internal uint uEdge;
        internal NativeMethods.Rect rc;
        internal nint lParam;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct Bitmap
    {
        internal int bmType;
        internal int bmWidth;
        internal int bmHeight;
        internal int bmWidthBytes;
        internal ushort bmPlanes;
        internal ushort bmBitsPixel;
        internal nint bmBits;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct IconInfo
    {
        [MarshalAs(UnmanagedType.Bool)]
        internal bool fIcon;
        internal uint xHotspot;
        internal uint yHotspot;
        internal nint hbmMask;
        internal nint hbmColor;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct BlendFunction
    {
        internal byte BlendOp;
        internal byte BlendFlags;
        internal byte SourceConstantAlpha;
        internal byte AlphaFormat;
    }

    internal delegate void WinEventProcedure(nint hook, uint eventType, nint hwnd, int objectId,
        int childId, uint eventThread, uint eventTime);

    internal delegate nint WindowProcedure(nint hwnd, uint message, nint wParam, nint lParam);

    [DllImport("user32.dll", EntryPoint = "FindWindowW", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern nint FindWindow(string? className, string? windowName);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetWindowRect(nint hwnd, out NativeMethods.Rect rect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool IsWindow(nint hwnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool IsWindowVisible(nint hwnd);

    [DllImport("user32.dll")]
    internal static extern nint GetForegroundWindow();

    [DllImport("user32.dll")]
    internal static extern nint MonitorFromWindow(nint hwnd, uint flags);

    [DllImport("user32.dll", EntryPoint = "CreateWindowExW", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern nint CreateWindowEx(uint exStyle, string className, string windowName,
        uint style, int x, int y, int width, int height, nint parent, nint menu, nint instance, nint parameter);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DestroyWindow(nint hwnd);

    [DllImport("user32.dll", EntryPoint = "DefWindowProcW")]
    internal static extern nint DefWindowProc(nint hwnd, uint message, nint wParam, nint lParam);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern nuint SetTimer(nint hwnd, nuint id, uint intervalMs, nint procedure);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool KillTimer(nint hwnd, nuint id);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ShowWindow(nint hwnd, int command);

    [DllImport("user32.dll")]
    internal static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll")]
    internal static extern nint SetCursor(nint cursor);

    [DllImport("user32.dll")]
    internal static extern nint LoadCursor(nint instance, nint name);

    [DllImport("user32.dll")]
    internal static extern nint GetDC(nint hwnd);

    [DllImport("user32.dll")]
    internal static extern int ReleaseDC(nint hwnd, nint dc);

    [DllImport("user32.dll", EntryPoint = "UpdateLayeredWindow", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool UpdateLayeredWindow(nint hwnd, nint destinationDc, ref NativeMethods.Point destination,
        ref NativeMethods.Point size, nint sourceDc, ref NativeMethods.Point source, uint colorKey,
        ref BlendFunction blend, uint flags);

    [DllImport("user32.dll", EntryPoint = "SetWinEventHook")]
    internal static extern nint SetWinEventHook(uint eventMin, uint eventMax, nint module, WinEventProcedure callback,
        uint processId, uint threadId, uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool UnhookWinEvent(nint hook);

    [DllImport("user32.dll", EntryPoint = "LoadImageW", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern nint LoadImage(nint instance, string name, uint type, int width, int height, uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetIconInfo(nint icon, out IconInfo info);

    [DllImport("user32.dll", EntryPoint = "DrawTextW", CharSet = CharSet.Unicode)]
    internal static extern int DrawText(nint dc, string text, int length, ref NativeMethods.Rect rect, uint format);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetTextExtentPoint32(nint dc, string text, int length, out Size32 size);

    [StructLayout(LayoutKind.Sequential)]
    internal struct Size32 { internal int Width; internal int Height; }

    [DllImport("gdi32.dll", SetLastError = true)]
    internal static extern nint CreateCompatibleDC(nint dc);

    [DllImport("gdi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DeleteDC(nint dc);

    [DllImport("gdi32.dll")]
    internal static extern nint SelectObject(nint dc, nint value);

    [DllImport("gdi32.dll")]
    internal static extern int SetBkMode(nint dc, int mode);

    [DllImport("gdi32.dll")]
    internal static extern uint SetTextColor(nint dc, uint color);

    [DllImport("gdi32.dll", EntryPoint = "CreateFontW", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern nint CreateFont(int height, int width, int escapement, int orientation, int weight,
        uint italic, uint underline, uint strikeOut, uint charSet, uint outputPrecision, uint clipPrecision,
        uint quality, uint pitchAndFamily, string face);

    [DllImport("gdi32.dll", EntryPoint = "CreateDIBSection", SetLastError = true)]
    internal static extern nint CreateDIBSection(nint dc, ref NativeMethods.BitmapInfo info, uint usage,
        out nint bits, nint section, uint offset);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DeleteObject(nint value);

    [DllImport("gdi32.dll", EntryPoint = "GetObjectW", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern int GetObject(nint handle, int size, out Bitmap bitmap);

    [DllImport("gdi32.dll", SetLastError = true)]
    internal static extern int GetDIBits(nint dc, nint bitmap, uint start, uint lines, byte[] bits,
        ref NativeMethods.BitmapInfo info, uint usage);

    [DllImport("shell32.dll", EntryPoint = "SHAppBarMessage")]
    internal static extern nint SHAppBarMessage(uint message, ref AppBarData data);

    [DllImport("shell32.dll")]
    internal static extern int SHQueryUserNotificationState(out int state);
}

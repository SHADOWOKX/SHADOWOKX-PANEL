using System.Runtime.InteropServices;
using ShadowokxPanel.Core.Models;
using Windows.UI;

namespace ShadowokxPanel.Platform;

public sealed class TrayIcon : IDisposable
{
    private const uint CallbackMessage = NativeMethods.WmApp + 41;
    private const uint IconId = 1;
    private const uint MenuOpen = 1001;
    private const uint MenuRefresh = 1002;
    private const uint MenuSettings = 1003;
    private const uint MenuStartup = 1004;
    private const uint MenuExit = 1005;
    private readonly nint _hwnd;
    private readonly Action _open;
    private readonly Action _refresh;
    private readonly Action _settings;
    private readonly Action _toggleStartup;
    private readonly Action _exit;
    private readonly Action _resume;
    private readonly NativeMethods.WindowProcedure _windowProcedure;
    private readonly nint _previousProcedure;
    private readonly uint _taskbarCreated;
    private nint _icon;
    private string _tooltip = "Shadowokx Panel";
    private UsagePace _pace;
    private Color _accent;
    private bool _disposed;

    public TrayIcon(
        nint hwnd,
        Action open,
        Action refresh,
        Action settings,
        Action toggleStartup,
        Action exit,
        Action resume,
        Color accent)
    {
        _hwnd = hwnd;
        _open = open;
        _refresh = refresh;
        _settings = settings;
        _toggleStartup = toggleStartup;
        _exit = exit;
        _resume = resume;
        _accent = accent;
        _windowProcedure = WindowProc;
        var pointer = Marshal.GetFunctionPointerForDelegate(_windowProcedure);
        _previousProcedure = NativeMethods.SetWindowLongPtr(hwnd, NativeMethods.GwlpWndProc, pointer);
        if (_previousProcedure == 0 && Marshal.GetLastWin32Error() != 0)
            throw new InvalidOperationException("The tray message handler could not be installed.");
        _taskbarCreated = NativeMethods.RegisterWindowMessage("TaskbarCreated");
        Add();
    }

    public void Update(string tooltip, UsagePace pace, Color accent)
    {
        if (_disposed)
            return;
        var normalizedTooltip = tooltip.Length <= 127 ? tooltip : tooltip[..127];
        if (_tooltip == normalizedTooltip && _pace == pace && _accent.Equals(accent))
            return;
        _tooltip = normalizedTooltip;
        _pace = pace;
        _accent = accent;
        ReplaceIcon();
        var data = Data(NativeMethods.NifIcon | NativeMethods.NifTip);
        NativeMethods.ShellNotifyIcon(NativeMethods.NimModify, ref data);
    }

    private void Add()
    {
        ReplaceIcon();
        var data = Data(NativeMethods.NifMessage | NativeMethods.NifIcon | NativeMethods.NifTip);
        NativeMethods.ShellNotifyIcon(NativeMethods.NimAdd, ref data);
        data.uVersion = NativeMethods.NotifyIconVersion4;
        NativeMethods.ShellNotifyIcon(NativeMethods.NimSetVersion, ref data);
    }

    private NativeMethods.NotifyIconData Data(uint flags) => new()
    {
        cbSize = (uint)Marshal.SizeOf<NativeMethods.NotifyIconData>(),
        hWnd = _hwnd,
        uID = IconId,
        uFlags = flags,
        uCallbackMessage = CallbackMessage,
        hIcon = _icon,
        szTip = _tooltip,
        szInfo = string.Empty,
        szInfoTitle = string.Empty,
    };

    private nint WindowProc(nint hwnd, uint message, nint wParam, nint lParam)
    {
        if (message == _taskbarCreated)
        {
            Add();
            return 0;
        }
        if (message == CallbackMessage)
        {
            var mouseMessage = (uint)(lParam.ToInt64() & 0xffff);
            if (mouseMessage is NativeMethods.WmLButtonUp or NativeMethods.WmLButtonDblClk)
                _open();
            else if (mouseMessage == NativeMethods.WmContextMenu)
                ShowMenu();
            return 0;
        }
        if (message == NativeMethods.WmPowerBroadcast &&
            wParam.ToInt32() == NativeMethods.PbtApmResumeAutomatic)
        {
            _resume();
            return 1;
        }
        return NativeMethods.CallWindowProc(_previousProcedure, hwnd, message, wParam, lParam);
    }

    private void ShowMenu()
    {
        var menu = NativeMethods.CreatePopupMenu();
        if (menu == 0)
            return;
        try
        {
            NativeMethods.AppendMenu(menu, NativeMethods.MfString, MenuOpen, "Open Shadowokx Panel");
            NativeMethods.AppendMenu(menu, NativeMethods.MfString, MenuRefresh, "Refresh");
            NativeMethods.AppendMenu(menu, NativeMethods.MfString, MenuSettings, "Settings");
            NativeMethods.AppendMenu(menu,
                NativeMethods.MfString | (StartupService.IsEnabled()
                    ? NativeMethods.MfChecked : NativeMethods.MfUnchecked),
                MenuStartup,
                "Start with Windows");
            NativeMethods.AppendMenu(menu, NativeMethods.MfSeparator, 0, null);
            NativeMethods.AppendMenu(menu, NativeMethods.MfString, MenuExit, "Exit");
            if (!NativeMethods.GetCursorPos(out var point))
                return;
            NativeMethods.SetForegroundWindow(_hwnd);
            var command = NativeMethods.TrackPopupMenuEx(
                menu,
                NativeMethods.TpmRightButton | NativeMethods.TpmReturnCmd | NativeMethods.TpmNonotify,
                point.X,
                point.Y,
                _hwnd,
                0);
            switch (command)
            {
                case MenuOpen: _open(); break;
                case MenuRefresh: _refresh(); break;
                case MenuSettings: _settings(); break;
                case MenuStartup: _toggleStartup(); break;
                case MenuExit: _exit(); break;
            }
        }
        finally
        {
            NativeMethods.DestroyMenu(menu);
        }
    }

    private void ReplaceIcon()
    {
        var color = _pace switch
        {
            UsagePace.Peak => Color.FromArgb(255, 249, 115, 22),
            UsagePace.Idle => Color.FromArgb(255, 59, 130, 246),
            _ => _accent,
        };
        var replacement = CreateIcon(color);
        var previous = _icon;
        _icon = replacement;
        if (previous != 0)
            NativeMethods.DestroyIcon(previous);
    }

    private static nint CreateIcon(Color color)
    {
        const int size = 32;
        var andMask = new byte[size * size / 8];
        var pixels = new byte[size * size * 4];
        for (var y = 0; y < size; y++)
        {
            for (var x = 0; x < size; x++)
            {
                var dx = x - 15.5;
                var dy = y - 15.5;
                var distance = Math.Sqrt(dx * dx + dy * dy);
                var index = ((size - 1 - y) * size + x) * 4;
                if (distance <= 14)
                {
                    var whiteMark = distance is >= 5.2 and <= 7.4 ||
                        Math.Abs(dx) < 1.6 && Math.Abs(dy) < 10;
                    pixels[index] = whiteMark ? (byte)245 : color.B;
                    pixels[index + 1] = whiteMark ? (byte)245 : color.G;
                    pixels[index + 2] = whiteMark ? (byte)245 : color.R;
                    pixels[index + 3] = 255;
                }
            }
        }
        var icon = NativeMethods.CreateIcon(0, size, size, 1, 32, andMask, pixels);
        return icon != 0 ? icon : throw new InvalidOperationException("Tray icon creation failed.");
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        var data = Data(0);
        NativeMethods.ShellNotifyIcon(NativeMethods.NimDelete, ref data);
        NativeMethods.SetWindowLongPtr(_hwnd, NativeMethods.GwlpWndProc, _previousProcedure);
        if (_icon != 0)
            NativeMethods.DestroyIcon(_icon);
        _icon = 0;
        GC.KeepAlive(_windowProcedure);
    }
}

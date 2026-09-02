using System.Runtime.InteropServices;
using ShadowokxPanel.Services;

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
    private int? _remainingPercent;
    private bool _useCapacityColors = true;
    private IconKey? _iconKey;
    private bool _disposed;

    public TrayIcon(
        nint hwnd,
        Action open,
        Action refresh,
        Action settings,
        Action toggleStartup,
        Action exit,
        Action resume)
    {
        _hwnd = hwnd;
        _open = open;
        _refresh = refresh;
        _settings = settings;
        _toggleStartup = toggleStartup;
        _exit = exit;
        _resume = resume;
        _windowProcedure = WindowProc;
        var pointer = Marshal.GetFunctionPointerForDelegate(_windowProcedure);
        _previousProcedure = NativeMethods.SetWindowLongPtr(hwnd, NativeMethods.GwlpWndProc, pointer);
        if (_previousProcedure == 0 && Marshal.GetLastWin32Error() != 0)
            throw new InvalidOperationException("The tray message handler could not be installed.");
        _taskbarCreated = NativeMethods.RegisterWindowMessage("TaskbarCreated");
        try
        {
            if (!Add())
                throw new InvalidOperationException("The notification-area icon could not be added.");
        }
        catch
        {
            Dispose();
            throw;
        }
    }

    public void Update(string tooltip, int? remainingPercent, bool useCapacityColors)
    {
        if (_disposed)
            return;
        var normalizedTooltip = tooltip.Length <= 127 ? tooltip : tooltip[..127];
        int? normalizedPercent = remainingPercent.HasValue
            ? Math.Clamp(remainingPercent.Value, 0, 100) : null;
        if (_tooltip == normalizedTooltip && _remainingPercent == normalizedPercent &&
            _useCapacityColors == useCapacityColors && IconMatchesCurrentDpi())
            return;
        _tooltip = normalizedTooltip;
        _remainingPercent = normalizedPercent;
        _useCapacityColors = useCapacityColors;
        UpdateIconAndTooltip();
    }

    private bool Add()
    {
        EnsureIcon();
        var data = Data(NativeMethods.NifMessage | NativeMethods.NifIcon | NativeMethods.NifTip);
        if (!NativeMethods.ShellNotifyIcon(NativeMethods.NimAdd, ref data))
            return false;
        data.uVersion = NativeMethods.NotifyIconVersion4;
        return NativeMethods.ShellNotifyIcon(NativeMethods.NimSetVersion, ref data);
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
            _ = Add();
            return 0;
        }
        if (message == CallbackMessage)
        {
            var mouseMessage = (uint)(lParam.ToInt64() & 0xffff);
            if (mouseMessage == NativeMethods.WmLButtonUp)
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
        if (message == NativeMethods.WmDpiChanged)
            UpdateIconAndTooltip(forceIcon: true);
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

    private bool IconMatchesCurrentDpi() =>
        _iconKey is { } key && key.Size == CurrentIconSize();

    private int CurrentIconSize()
    {
        var dpi = Math.Max(96, NativeMethods.GetDpiForWindow(_hwnd));
        var width = NativeMethods.GetSystemMetricsForDpi(NativeMethods.SmCxSmallIcon, dpi);
        var height = NativeMethods.GetSystemMetricsForDpi(NativeMethods.SmCySmallIcon, dpi);
        return Math.Clamp(Math.Max(width, height), 16, 64);
    }

    private void EnsureIcon()
    {
        var key = new IconKey(CurrentIconSize(), _remainingPercent, _useCapacityColors);
        if (_icon != 0 && _iconKey == key)
            return;
        var replacement = TrayIconRenderer.Create(
            key.Size, key.RemainingPercent, key.UseCapacityColors);
        var previous = _icon;
        _icon = replacement;
        _iconKey = key;
        if (previous != 0)
            NativeMethods.DestroyIcon(previous);
    }

    private void UpdateIconAndTooltip(bool forceIcon = false)
    {
        if (_disposed)
            return;
        var desired = new IconKey(CurrentIconSize(), _remainingPercent, _useCapacityColors);
        var replace = forceIcon || _icon == 0 || _iconKey != desired;
        nint replacement;
        try
        {
            replacement = replace
                ? TrayIconRenderer.Create(
                    desired.Size, desired.RemainingPercent, desired.UseCapacityColors)
                : _icon;
        }
        catch (InvalidOperationException error)
        {
            // Keep the last valid shell icon if a transient GDI allocation fails.
            StartupDiagnostics.WriteException("tray icon update failed", error);
            return;
        }
        var previous = _icon;
        var data = Data(NativeMethods.NifIcon | NativeMethods.NifTip) with
        {
            hIcon = replacement,
        };
        if (!NativeMethods.ShellNotifyIcon(NativeMethods.NimModify, ref data))
        {
            if (replacement != previous)
                NativeMethods.DestroyIcon(replacement);
            return;
        }
        _icon = replacement;
        _iconKey = desired;
        if (previous != 0 && previous != replacement)
            NativeMethods.DestroyIcon(previous);
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
        _iconKey = null;
        GC.KeepAlive(_windowProcedure);
    }

    private readonly record struct IconKey(
        int Size,
        int? RemainingPercent,
        bool UseCapacityColors);
}

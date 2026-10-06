using System.Runtime.InteropServices;
using ShadowokxPanel.Services;

namespace ShadowokxPanel.Platform.Taskbar;

// A transparent, non-activating, topmost tool window pinned to the taskbar. It is a
// plain layered Win32 window (not a WinUI window) so it can never take focus and never
// appears in the taskbar or Alt+Tab. Pixels are supplied by TaskbarWidgetRenderer.
internal sealed class TaskbarWidgetWindow : IDisposable
{
    private readonly TaskbarInterop.WindowProcedure _procedure;
    private readonly nint _previousProcedure;
    private readonly uint _taskbarCreated;
    private readonly nint _hwnd;
    private nint _dib;
    private nint _bits;
    private nint _memoryDc;
    private int _width;
    private int _height;
    private bool _visible;
    private bool _disposed;

    internal event Action? Clicked;
    internal event Action? ShellChanged;

    internal TaskbarWidgetWindow()
    {
        _procedure = WindowProc;
        _hwnd = TaskbarInterop.CreateWindowEx(
            TaskbarInterop.WsExLayered | TaskbarInterop.WsExToolWindow |
            TaskbarInterop.WsExNoActivate | TaskbarInterop.WsExTopmost,
            "STATIC", "Shadowokx Panel companion", TaskbarInterop.WsPopup,
            0, 0, 1, 1, 0, 0, 0, 0);
        if (_hwnd == 0)
            throw new InvalidOperationException("The taskbar widget window could not be created.");
        try
        {
            var pointer = Marshal.GetFunctionPointerForDelegate(_procedure);
            _previousProcedure = NativeMethods.SetWindowLongPtr(_hwnd, NativeMethods.GwlpWndProc, pointer);
            if (_previousProcedure == 0 && Marshal.GetLastPInvokeError() != 0)
                throw new InvalidOperationException("The taskbar widget message handler could not be installed.");
            _taskbarCreated = NativeMethods.RegisterWindowMessage("TaskbarCreated");
            TaskbarInterop.ShowWindow(_hwnd, TaskbarInterop.SwHide);
        }
        catch
        {
            Dispose();
            throw;
        }
    }

    internal void Apply(byte[] pixels, int width, int height, int x, int y, bool visible)
    {
        if (_disposed || _hwnd == 0 || width <= 0 || height <= 0)
            return;
        EnsureSurface(width, height);
        if (_dib == 0 || _memoryDc == 0)
            return;
        if (pixels.Length != width * height * 4)
            return;
        Marshal.Copy(pixels, 0, _bits, pixels.Length);

        var screenDc = TaskbarInterop.GetDC(0);
        if (screenDc == 0)
            return;
        try
        {
            var destination = new NativeMethods.Point { X = x, Y = y };
            var size = new NativeMethods.Point { X = width, Y = height };
            var source = new NativeMethods.Point { X = 0, Y = 0 };
            var blend = new TaskbarInterop.BlendFunction
            {
                BlendOp = 0,
                SourceConstantAlpha = 255,
                AlphaFormat = 1,
            };
            if (!TaskbarInterop.UpdateLayeredWindow(_hwnd, screenDc, ref destination, ref size, _memoryDc,
                    ref source, 0, ref blend, TaskbarInterop.UlwAlpha))
                return;
        }
        finally
        {
            _ = TaskbarInterop.ReleaseDC(0, screenDc);
        }
        if (!visible)
        {
            Hide();
            return;
        }
        if (!_visible)
        {
            TaskbarInterop.ShowWindow(_hwnd, TaskbarInterop.SwShownoactivate);
            _visible = true;
        }
        NativeMethods.SetWindowPos(_hwnd, TaskbarInterop.HwndTopmost, x, y, width, height,
            TaskbarInterop.SwpNoActivate);
    }

    internal void Hide()
    {
        if (_disposed || _hwnd == 0 || !_visible)
            return;
        TaskbarInterop.ShowWindow(_hwnd, TaskbarInterop.SwHide);
        _visible = false;
    }

    private void EnsureSurface(int width, int height)
    {
        if (_dib != 0 && _width == width && _height == height)
            return;
        DestroySurface();
        var info = new NativeMethods.BitmapInfo
        {
            bmiHeader = new NativeMethods.BitmapInfoHeader
            {
                biSize = (uint)Marshal.SizeOf<NativeMethods.BitmapInfoHeader>(),
                biWidth = width,
                biHeight = -height,
                biPlanes = 1,
                biBitCount = 32,
                biCompression = TaskbarInterop.BiRgb,
                biSizeImage = (uint)(width * height * 4),
            },
        };
        _dib = TaskbarInterop.CreateDIBSection(0, ref info, TaskbarInterop.DibRgbColors, out var bits, 0, 0);
        if (_dib == 0 || bits == 0)
        {
            if (_dib != 0)
                NativeMethods.DeleteObject(_dib);
            _dib = 0;
            return;
        }
        _bits = bits;
        _memoryDc = TaskbarInterop.CreateCompatibleDC(0);
        if (_memoryDc == 0)
        {
            NativeMethods.DeleteObject(_dib);
            _dib = 0;
            _bits = 0;
            return;
        }
        TaskbarInterop.SelectObject(_memoryDc, _dib);
        _width = width;
        _height = height;
    }

    private void DestroySurface()
    {
        if (_memoryDc != 0)
        {
            TaskbarInterop.DeleteDC(_memoryDc);
            _memoryDc = 0;
        }
        if (_dib != 0)
        {
            NativeMethods.DeleteObject(_dib);
            _dib = 0;
        }
        _bits = 0;
        _width = 0;
        _height = 0;
    }

    private nint WindowProc(nint hwnd, uint message, nint wParam, nint lParam)
    {
        try
        {
            return Dispatch(hwnd, message, wParam, lParam);
        }
        catch (Exception error)
        {
            StartupDiagnostics.WriteException("taskbar widget message failed", error);
            try { ShellChanged?.Invoke(); } catch (Exception nested) { StartupDiagnostics.WriteException("taskbar shell refresh failed", nested); }
            return TaskbarInterop.DefWindowProc(hwnd, message, wParam, lParam);
        }
    }

    private nint Dispatch(nint hwnd, uint message, nint wParam, nint lParam)
    {
        if (message == _taskbarCreated)
        {
            ShellChanged?.Invoke();
            return 0;
        }
        switch (message)
        {
            case TaskbarInterop.WmMouseActivate:
                return TaskbarInterop.MaNoActivate;
            case TaskbarInterop.WmLButtonUp:
            case TaskbarInterop.WmRButtonUp:
                Clicked?.Invoke();
                return 0;
            case TaskbarInterop.WmSetcursor:
                TaskbarInterop.SetCursor(TaskbarInterop.LoadCursor(0, TaskbarInterop.IdcArrow));
                return 1;
            case TaskbarInterop.WmDpiChanged:
            case TaskbarInterop.WmDisplayChange:
                ShellChanged?.Invoke();
                break;
        }
        return TaskbarInterop.DefWindowProc(hwnd, message, wParam, lParam);
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        if (_hwnd != 0)
        {
            if (_previousProcedure != 0)
                NativeMethods.SetWindowLongPtr(_hwnd, NativeMethods.GwlpWndProc, _previousProcedure);
            TaskbarInterop.DestroyWindow(_hwnd);
        }
        DestroySurface();
    }
}

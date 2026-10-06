using System.Runtime.InteropServices;

namespace ShadowokxPanel.Platform.Taskbar;

internal readonly record struct TaskbarRenderRequest(string Text, string FrameName, byte Red, byte Green, byte Blue);

// Composes the widget surface as premultiplied BGRA for UpdateLayeredWindow. The
// mascot is extracted from the shared .ico frames; the percentage is drawn once as a
// white coverage mask and tinted with the shared status color.
internal sealed class TaskbarWidgetRenderer : IDisposable
{
    private readonly TaskbarMascotFrames _frames;
    private nint _dc;
    private nint _font;
    private int _fontHeight;
    private bool _disposed;

    public TaskbarWidgetRenderer(TaskbarMascotFrames frames) => _frames = frames;

    public (byte[] Pixels, int Width, int Height) Render(TaskbarRenderRequest request, TaskbarSnapshot snapshot)
    {
        var taskbarHeight = Math.Max(1, snapshot.Taskbar.Height);
        var mascotSize = TaskbarWidgetGeometry.MascotSize(taskbarHeight);
        var padding = TaskbarWidgetGeometry.Scaled(5, snapshot.Scale);
        var gap = TaskbarWidgetGeometry.Scaled(4, snapshot.Scale);
        var fontHeight = Math.Max(10, (int)Math.Round(mascotSize * 0.72, MidpointRounding.AwayFromZero));
        var textWidth = MeasureText(request.Text, fontHeight);
        var width = TaskbarWidgetGeometry.ContentWidth(mascotSize, textWidth, padding, gap);
        var height = TaskbarWidgetGeometry.WidgetHeight(taskbarHeight);
        var buffer = new byte[width * height * 4];

        var mascot = _frames.Get(request.FrameName, mascotSize);
        if (mascot is not null)
            CompositeBitmap(buffer, width, height, mascot, padding, (height - mascotSize) / 2);

        var maskWidth = Math.Max(1, textWidth + 2);
        var mask = RenderTextMask(request.Text, maskWidth, height, fontHeight);
        if (mask is not null)
            CompositeMask(buffer, width, height, mask, maskWidth, height, padding + mascotSize + gap, request);

        return (buffer, width, height);
    }

    private void EnsureFont(int height)
    {
        _dc = _dc != 0 ? _dc : TaskbarInterop.CreateCompatibleDC(0);
        if (_font != 0 && _fontHeight == height)
            return;
        var replacement = TaskbarInterop.CreateFont(-height, 0, 0, 0, 600, 0, 0, 0,
            TaskbarInterop.DefaultCharSet, 0, 0, TaskbarInterop.AntialiasedQuality, 0, "Segoe UI");
        var previous = _font;
        _font = replacement;
        _fontHeight = height;
        if (previous != 0)
            NativeMethods.DeleteObject(previous);
    }

    private int MeasureText(string text, int fontHeight)
    {
        EnsureFont(fontHeight);
        if (_dc == 0 || _font == 0 || text.Length == 0)
            return Math.Max(1, text.Length * (fontHeight / 2));
        var previous = TaskbarInterop.SelectObject(_dc, _font);
        try
        {
            return TaskbarInterop.GetTextExtentPoint32(_dc, text, text.Length, out var size) && size.Width > 0
                ? size.Width
                : Math.Max(1, text.Length * (fontHeight / 2));
        }
        finally
        {
            TaskbarInterop.SelectObject(_dc, previous);
        }
    }

    private byte[]? RenderTextMask(string text, int width, int height, int fontHeight)
    {
        EnsureFont(fontHeight);
        if (_dc == 0 || _font == 0)
            return null;
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
        var bitmap = TaskbarInterop.CreateDIBSection(0, ref info, TaskbarInterop.DibRgbColors, out var bits, 0, 0);
        if (bitmap == 0 || bits == 0)
        {
            if (bitmap != 0)
                NativeMethods.DeleteObject(bitmap);
            return null;
        }
        var memoryDc = TaskbarInterop.CreateCompatibleDC(_dc);
        var previousBitmap = TaskbarInterop.SelectObject(memoryDc, bitmap);
        var previousFont = TaskbarInterop.SelectObject(memoryDc, _font);
        try
        {
            TaskbarInterop.SetBkMode(memoryDc, TaskbarInterop.Transparent);
            TaskbarInterop.SetTextColor(memoryDc, 0x00FFFFFF);
            var rect = new NativeMethods.Rect { Left = 0, Top = 0, Right = width, Bottom = height };
            TaskbarInterop.DrawText(memoryDc, text, text.Length, ref rect,
                TaskbarInterop.DtLeft | TaskbarInterop.DtVCenter | TaskbarInterop.DtSingleLine | TaskbarInterop.DtNoPrefix);
            var pixels = new byte[width * height * 4];
            Marshal.Copy(bits, pixels, 0, pixels.Length);
            return pixels;
        }
        finally
        {
            TaskbarInterop.SelectObject(memoryDc, previousFont);
            TaskbarInterop.SelectObject(memoryDc, previousBitmap);
            TaskbarInterop.DeleteDC(memoryDc);
            NativeMethods.DeleteObject(bitmap);
        }
    }

    private static void CompositeBitmap(byte[] buffer, int width, int height, MascotBitmap bitmap, int left, int top)
    {
        for (var y = 0; y < bitmap.Height; y++)
        {
            var destinationY = top + y;
            if (destinationY < 0 || destinationY >= height)
                continue;
            for (var x = 0; x < bitmap.Width; x++)
            {
                var destinationX = left + x;
                if (destinationX < 0 || destinationX >= width)
                    continue;
                var source = (y * bitmap.Width + x) * 4;
                var alpha = bitmap.Bgra[source + 3];
                if (alpha == 0)
                    continue;
                var scale = alpha / 255f;
                var destination = (destinationY * width + destinationX) * 4;
                var inverse = 1f - scale;
                buffer[destination] = Clamp255(bitmap.Bgra[source] * scale + buffer[destination] * inverse);
                buffer[destination + 1] = Clamp255(bitmap.Bgra[source + 1] * scale + buffer[destination + 1] * inverse);
                buffer[destination + 2] = Clamp255(bitmap.Bgra[source + 2] * scale + buffer[destination + 2] * inverse);
                buffer[destination + 3] = Clamp255(alpha + buffer[destination + 3] * inverse);
            }
        }
    }

    private static void CompositeMask(byte[] buffer, int width, int height, byte[] mask, int maskWidth,
        int maskHeight, int left, TaskbarRenderRequest request)
    {
        for (var y = 0; y < maskHeight; y++)
        {
            var destinationY = y;
            if (destinationY < 0 || destinationY >= height)
                continue;
            for (var x = 0; x < maskWidth; x++)
            {
                var destinationX = left + x;
                if (destinationX < 0 || destinationX >= width)
                    continue;
                var coverage = mask[(y * maskWidth + x) * 4 + 2];
                if (coverage == 0)
                    continue;
                var scale = coverage / 255f;
                var destination = (destinationY * width + destinationX) * 4;
                var inverse = 1f - scale;
                buffer[destination] = Clamp255(request.Blue * scale + buffer[destination] * inverse);
                buffer[destination + 1] = Clamp255(request.Green * scale + buffer[destination + 1] * inverse);
                buffer[destination + 2] = Clamp255(request.Red * scale + buffer[destination + 2] * inverse);
                buffer[destination + 3] = Clamp255(coverage + buffer[destination + 3] * inverse);
            }
        }
    }

    private static byte Clamp255(float value) => (byte)Math.Clamp((int)MathF.Round(value), 0, 255);

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        if (_font != 0)
            NativeMethods.DeleteObject(_font);
        _font = 0;
        if (_dc != 0)
            TaskbarInterop.DeleteDC(_dc);
        _dc = 0;
    }
}

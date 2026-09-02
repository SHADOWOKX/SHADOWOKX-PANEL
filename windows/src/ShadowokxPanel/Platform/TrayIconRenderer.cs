using System.Runtime.InteropServices;
using ShadowokxPanel.Core.Presentation;

namespace ShadowokxPanel.Platform;

internal static class TrayIconRenderer
{
    private const int GlyphColor = unchecked((int)0xFFFFFFFF);

    public static nint Create(int size, int? remainingPercent)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(size);

        var glyph = TrayPercentageGlyphFactory.Create(remainingPercent);
        var pixels = new int[checked(size * size)];
        var padding = Math.Max(1, size / 16);
        var usable = Math.Max(1, size - padding * 2);
        var scaleY = Math.Max(1, usable / glyph.Height);
        var scaleX = Math.Max(1, Math.Min(usable / glyph.Width, scaleY));
        var renderedWidth = glyph.Width * scaleX;
        var renderedHeight = glyph.Height * scaleY;
        var left = Math.Max(0, (size - renderedWidth) / 2);
        var top = Math.Max(0, (size - renderedHeight) / 2);

        foreach (var point in glyph.Pixels)
        {
            var startX = left + point.X * scaleX;
            var startY = top + point.Y * scaleY;
            for (var y = 0; y < scaleY && startY + y < size; y++)
            {
                var row = (startY + y) * size;
                for (var x = 0; x < scaleX && startX + x < size; x++)
                    pixels[row + startX + x] = GlyphColor;
            }
        }

        var bitmapInfo = new NativeMethods.BitmapInfo
        {
            bmiHeader = new NativeMethods.BitmapInfoHeader
            {
                biSize = (uint)Marshal.SizeOf<NativeMethods.BitmapInfoHeader>(),
                biWidth = size,
                biHeight = -size,
                biPlanes = 1,
                biBitCount = 32,
                biCompression = NativeMethods.BiRgb,
                biSizeImage = (uint)(pixels.Length * sizeof(int)),
            },
        };
        var colorBitmap = NativeMethods.CreateDIBSection(
            0, ref bitmapInfo, NativeMethods.DibRgbColors, out var bits, 0, 0);
        if (colorBitmap == 0)
            throw new InvalidOperationException("The tray color bitmap could not be created.");
        if (bits == 0)
        {
            NativeMethods.DeleteObject(colorBitmap);
            throw new InvalidOperationException("The tray color bitmap did not expose pixel storage.");
        }

        nint maskBitmap = 0;
        GCHandle maskHandle = default;
        try
        {
            Marshal.Copy(pixels, 0, bits, pixels.Length);
            var maskStride = ((size + 15) / 16) * 2;
            var maskPixels = new byte[checked(maskStride * size)];
            Array.Fill(maskPixels, byte.MaxValue);
            for (var y = 0; y < size; y++)
            {
                for (var x = 0; x < size; x++)
                {
                    if (pixels[y * size + x] == 0)
                        continue;
                    var maskIndex = y * maskStride + x / 8;
                    maskPixels[maskIndex] &= (byte)~(0x80 >> x % 8);
                }
            }
            maskHandle = GCHandle.Alloc(maskPixels, GCHandleType.Pinned);
            maskBitmap = NativeMethods.CreateBitmap(
                size, size, 1, 1, maskHandle.AddrOfPinnedObject());
            if (maskBitmap == 0)
                throw new InvalidOperationException("The tray transparency mask could not be created.");
            var iconInfo = new NativeMethods.IconInfo
            {
                fIcon = true,
                hbmColor = colorBitmap,
                hbmMask = maskBitmap,
            };
            var icon = NativeMethods.CreateIconIndirect(ref iconInfo);
            if (icon == 0)
                throw new InvalidOperationException("The tray percentage icon could not be created.");
            return icon;
        }
        finally
        {
            if (maskHandle.IsAllocated)
                maskHandle.Free();
            if (maskBitmap != 0)
                NativeMethods.DeleteObject(maskBitmap);
            NativeMethods.DeleteObject(colorBitmap);
        }
    }
}

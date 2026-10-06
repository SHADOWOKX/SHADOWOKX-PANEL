using System.Text.Json;

namespace ShadowokxPanel.Platform.Taskbar;

internal sealed record MascotBitmap(int Width, int Height, byte[] Bgra);

internal readonly record struct MascotFrame(string Name, int DurationMs);

// Loads the same Clawd/octopus sprite frames the panel uses, straight from the shared
// .ico assets and animations.json. Frames are extracted through documented GDI calls
// (GetIconInfo + GetDIBits) so no image codec or extra runtime is required.
internal sealed class TaskbarMascotFrames
{
    public const string IdleFrame = "robot-awake";
    private readonly string _directory;
    private readonly Dictionary<(string Name, int Size), MascotBitmap> _cache = [];

    public TaskbarMascotFrames(string? directory = null)
    {
        _directory = directory ?? Path.Combine(AppContext.BaseDirectory, "Assets", "Companions", "octopus");
        (WorkIntro, WorkLoop) = LoadSequences();
    }

    public IReadOnlyList<MascotFrame> WorkIntro { get; }
    public IReadOnlyList<MascotFrame> WorkLoop { get; }

    private (List<MascotFrame> Intro, List<MascotFrame> Loop) LoadSequences()
    {
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(_directory, "animations.json")));
            return (ReadSequence(document.RootElement, "workIntro"), ReadSequence(document.RootElement, "workLoop"));
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException)
        {
            return ([], []);
        }
    }

    private static List<MascotFrame> ReadSequence(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var sequence) || sequence.ValueKind != JsonValueKind.Array)
            return [];
        var frames = new List<MascotFrame>();
        foreach (var entry in sequence.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.Array || entry.GetArrayLength() < 2)
                continue;
            var file = entry[0].GetString();
            if (string.IsNullOrEmpty(file))
                continue;
            frames.Add(new MascotFrame(file.Replace(".svg", string.Empty, StringComparison.Ordinal),
                entry[1].GetInt32()));
        }
        return frames;
    }

    public MascotBitmap? Get(string name, int size)
    {
        if (size <= 0)
            return null;
        if (_cache.TryGetValue((name, size), out var cached))
            return cached;
        var bitmap = Load(name, size);
        if (bitmap is not null)
            _cache[(name, size)] = bitmap;
        return bitmap;
    }

    private MascotBitmap? Load(string name, int size)
    {
        var path = Path.Combine(_directory, name + ".ico");
        if (!File.Exists(path))
            return null;
        var icon = TaskbarInterop.LoadImage(0, path, TaskbarInterop.ImageIcon, size, size,
            TaskbarInterop.LrLoadFromFile);
        if (icon == 0)
            return null;
        nint color = 0;
        nint mask = 0;
        try
        {
            if (!TaskbarInterop.GetIconInfo(icon, out var info))
                return null;
            color = info.hbmColor;
            mask = info.hbmMask;
            if (color == 0)
                return null;
            return Extract(color, size);
        }
        finally
        {
            if (color != 0)
                NativeMethods.DeleteObject(color);
            if (mask != 0)
                NativeMethods.DeleteObject(mask);
            NativeMethods.DestroyIcon(icon);
        }
    }

    private static MascotBitmap? Extract(nint colorBitmap, int target)
    {
        if (TaskbarInterop.GetObject(colorBitmap, System.Runtime.InteropServices.Marshal.SizeOf<TaskbarInterop.Bitmap>(),
                out var source) == 0)
            return null;
        var width = source.bmWidth;
        var height = Math.Abs(source.bmHeight);
        if (width <= 0 || height <= 0)
            return null;

        var info = new NativeMethods.BitmapInfo
        {
            bmiHeader = new NativeMethods.BitmapInfoHeader
            {
                biSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf<NativeMethods.BitmapInfoHeader>(),
                biWidth = width,
                biHeight = -height,
                biPlanes = 1,
                biBitCount = 32,
                biCompression = TaskbarInterop.BiRgb,
                biSizeImage = (uint)(width * height * 4),
            },
        };
        var pixels = new byte[width * height * 4];
        var dc = TaskbarInterop.GetDC(0);
        if (dc == 0)
            return null;
        int copied;
        try
        {
            copied = TaskbarInterop.GetDIBits(dc, colorBitmap, 0, (uint)height, pixels, ref info,
                TaskbarInterop.DibRgbColors);
        }
        finally
        {
            _ = TaskbarInterop.ReleaseDC(0, dc);
        }
        if (copied == 0)
            return null;

        var opaque = false;
        for (var index = 3; index < pixels.Length; index += 4)
        {
            if (pixels[index] != 0)
            {
                opaque = true;
                break;
            }
        }
        // Icons without an alpha channel fall back to "any non-black pixel is opaque".
        if (!opaque)
            for (var index = 0; index < pixels.Length; index += 4)
                if (pixels[index] != 0 || pixels[index + 1] != 0 || pixels[index + 2] != 0)
                    pixels[index + 3] = 255;

        return Scale(pixels, width, height, target);
    }

    private static MascotBitmap Scale(byte[] source, int sourceWidth, int sourceHeight, int target)
    {
        var size = Math.Max(1, target);
        var output = new byte[size * size * 4];
        for (var y = 0; y < size; y++)
        {
            var sourceY = Math.Min(sourceHeight - 1, y * sourceHeight / size);
            for (var x = 0; x < size; x++)
            {
                var sourceX = Math.Min(sourceWidth - 1, x * sourceWidth / size);
                var from = (sourceY * sourceWidth + sourceX) * 4;
                var to = (y * size + x) * 4;
                output[to] = source[from];
                output[to + 1] = source[from + 1];
                output[to + 2] = source[from + 2];
                output[to + 3] = source[from + 3];
            }
        }
        return new MascotBitmap(size, size, output);
    }
}

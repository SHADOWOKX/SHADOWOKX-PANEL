namespace ShadowokxPanel.Core.Presentation;

public readonly record struct ScreenRect(int X, int Y, int Width, int Height)
{
    public int Right => X + Width;
    public int Bottom => Y + Height;
}

public static class PopupPlacement
{
    // All arguments are physical pixels. Never mix XAML DIPs with monitor coordinates.
    public static ScreenRect Calculate(ScreenRect work, ScreenRect monitor,
        int anchorX, int anchorY, double scale, int desiredWidth, int desiredHeight)
    {
        scale = double.IsFinite(scale) ? Math.Clamp(scale, 1, 8) : 1;
        var margin = Math.Min((int)Math.Round(10 * scale), Math.Max(0, Math.Min(work.Width, work.Height) / 4));
        var width = Math.Clamp((int)Math.Round(desiredWidth * scale), 1, Math.Max(1, work.Width - 2 * margin));
        var height = Math.Clamp((int)Math.Round(desiredHeight * scale), 1, Math.Max(1, work.Height - 2 * margin));
        var x = work.X > monitor.X ? work.X + margin : work.Right < monitor.Right
            ? work.Right - width - margin : anchorX - width / 2;
        var y = work.Y > monitor.Y ? work.Y + margin : work.Bottom < monitor.Bottom
            ? work.Bottom - height - margin : anchorY - height - margin;
        return new ScreenRect(
            Math.Clamp(x, work.X + margin, Math.Max(work.X + margin, work.Right - width - margin)),
            Math.Clamp(y, work.Y + margin, Math.Max(work.Y + margin, work.Bottom - height - margin)), width, height);
    }
}

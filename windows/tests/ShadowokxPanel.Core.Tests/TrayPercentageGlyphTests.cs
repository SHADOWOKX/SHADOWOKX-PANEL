using ShadowokxPanel.Core.Presentation;

namespace ShadowokxPanel.Core.Tests;

public sealed class TrayPercentageGlyphTests
{
    [Theory]
    [InlineData(100, "100%", 11)]
    [InlineData(95, "95%", 7)]
    [InlineData(6, "6%", 3)]
    [InlineData(0, "0%", 3)]
    public void PercentageUsesCompactPixelLayout(int value, string text, int width)
    {
        var glyph = TrayPercentageGlyphFactory.Create(value);

        Assert.Equal($"{text} remaining", glyph.AccessibleText);
        Assert.Equal(width, glyph.Width);
        Assert.Equal(5, glyph.Height);
        Assert.NotEmpty(glyph.Pixels);
        Assert.All(glyph.Pixels, point =>
        {
            Assert.InRange(point.X, 0, glyph.Width - 1);
            Assert.InRange(point.Y, 0, glyph.Height - 1);
        });
    }

    [Fact]
    public void UnavailableStateDoesNotPretendToKnowCapacity()
    {
        var unavailable = TrayPercentageGlyphFactory.Create(null);
        Assert.Equal("Codex usage unavailable", unavailable.AccessibleText);
        Assert.NotEmpty(unavailable.Pixels);
    }

    [Theory]
    [InlineData(-5, "0% remaining")]
    [InlineData(105, "100% remaining")]
    public void ValuesAreClampedToValidPercentageRange(int value, string expected)
    {
        Assert.Equal(expected, TrayPercentageGlyphFactory.Create(value).AccessibleText);
    }
}

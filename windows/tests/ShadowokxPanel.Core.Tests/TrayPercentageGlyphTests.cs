using ShadowokxPanel.Core.Presentation;

namespace ShadowokxPanel.Core.Tests;

public sealed class TrayPercentageGlyphTests
{
    [Theory]
    [InlineData(100, "100%", 15)]
    [InlineData(95, "95%", 11)]
    [InlineData(6, "6%", 7)]
    [InlineData(0, "0%", 7)]
    public void PercentageUsesCompactPixelLayout(int value, string text, int width)
    {
        var glyph = TrayPercentageGlyphFactory.Create(value, true);

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

    [Theory]
    [InlineData(100, TrayGlyphTone.Healthy)]
    [InlineData(60, TrayGlyphTone.Healthy)]
    [InlineData(59, TrayGlyphTone.Balanced)]
    [InlineData(30, TrayGlyphTone.Balanced)]
    [InlineData(29, TrayGlyphTone.Warning)]
    [InlineData(0, TrayGlyphTone.Warning)]
    public void CapacityColorsFollowRemainingPercentage(int value, TrayGlyphTone expected)
    {
        Assert.Equal(expected, TrayPercentageGlyphFactory.Create(value, true).Tone);
    }

    [Fact]
    public void NeutralModeAndUnavailableStateDoNotPretendToKnowCapacity()
    {
        Assert.Equal(TrayGlyphTone.Neutral, TrayPercentageGlyphFactory.Create(5, false).Tone);
        var unavailable = TrayPercentageGlyphFactory.Create(null, true);
        Assert.Equal("Codex usage unavailable", unavailable.AccessibleText);
        Assert.Equal(TrayGlyphTone.Neutral, unavailable.Tone);
        Assert.NotEmpty(unavailable.Pixels);
    }

    [Theory]
    [InlineData(-5, "0% remaining")]
    [InlineData(105, "100% remaining")]
    public void ValuesAreClampedToValidPercentageRange(int value, string expected)
    {
        Assert.Equal(expected, TrayPercentageGlyphFactory.Create(value, true).AccessibleText);
    }
}

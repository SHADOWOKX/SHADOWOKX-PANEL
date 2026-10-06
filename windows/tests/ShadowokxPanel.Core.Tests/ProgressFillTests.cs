using ShadowokxPanel.Core.History;
using ShadowokxPanel.Core.Presentation;

namespace ShadowokxPanel.Core.Tests;

public sealed class ProgressFillTests
{
    [Theory]
    [InlineData(57, 200, 114)]
    [InlineData(17, 100, 17)]
    [InlineData(100, 50, 50)]
    [InlineData(0, 50, 0)]
    [InlineData(150, 50, 50)]
    [InlineData(-10, 50, 0)]
    public void DisplayedPercentEqualsVisibleFill(double percent, double width, long expected)
    {
        var geometry = ProgressFill.Geometry(percent, width);
        Assert.Equal(expected, geometry.FillWidth);
    }

    [Fact]
    public void InsetsAreExcludedFromTheUsableTrack()
    {
        var geometry = ProgressFill.Geometry(17, 100, 3, 2);
        Assert.Equal(95, geometry.UsableWidth);
        Assert.Equal(16, geometry.FillWidth);
        Assert.Equal(16d / 95, (double)geometry.FillWidth / geometry.UsableWidth, 3);
    }

    [Fact]
    public void TextAndBarShareOneCanonicalRemainingValue()
    {
        var remaining = AllowanceStatus.Remaining(43);
        Assert.Equal(57d, remaining);
        var geometry = ProgressFill.Geometry(remaining!.Value, 200);
        Assert.Equal(0.57, (double)geometry.FillWidth / 200, 3);
        Assert.Equal("Comfortable", UsageAnalytics.CapacityLabel(AllowanceStatus.Remaining(30)));
        Assert.Equal("Steady", UsageAnalytics.CapacityLabel(remaining));
        Assert.Equal("Limited", UsageAnalytics.CapacityLabel(AllowanceStatus.Remaining(80)));
        Assert.Equal("Low", UsageAnalytics.CapacityLabel(AllowanceStatus.Remaining(95)));
    }
}

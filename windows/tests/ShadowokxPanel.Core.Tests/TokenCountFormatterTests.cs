using System.Globalization;
using ShadowokxPanel.Core.Presentation;

namespace ShadowokxPanel.Core.Tests;

public sealed class TokenCountFormatterTests
{
    [Theory]
    [InlineData(1_135_204_982, "1.1B")]
    [InlineData(76_900_000, "76.9M")]
    [InlineData(5_655_222, "5.7M")]
    [InlineData(12_800, "12.8K")]
    [InlineData(999, "999")]
    public void UsesCompactScaledUnits(long value, string expected)
    {
        Assert.Equal(expected, TokenCountFormatter.Format(value, CultureInfo.InvariantCulture));
    }

    [Fact]
    public void UsesTheProvidedCultureForTheDecimalSeparator()
    {
        Assert.Equal("1,1B", TokenCountFormatter.Format(
            1_135_204_982, CultureInfo.GetCultureInfo("de-DE")));
    }
}

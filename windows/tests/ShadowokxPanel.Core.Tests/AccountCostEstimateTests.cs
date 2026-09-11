using System.Globalization;
using ShadowokxPanel.Core.Presentation;
using ShadowokxPanel.Core.Settings;

namespace ShadowokxPanel.Core.Tests;

public sealed class AccountCostEstimateTests
{
    [Fact]
    public void MixedTokenTypesUseTheirOwnOfficialRates()
    {
        var settings = new AppSettings { EstimateCachedPercent = 90, EstimateOutputPercent = 2, EstimateWritePercent = 1 };
        // 70K * $4 + 900K * $.4 + 20K * $20 + 10K * $5, per million.
        Assert.Equal(1.09m, AccountCostEstimate.Calculate(1_000_000, settings));
        Assert.Equal(2.18m, AccountCostEstimate.Calculate(2_000_000, settings));
    }

    [Fact]
    public void LongContextUsesModelSpecificCacheMultiplier()
    {
        var settings = new AppSettings { EstimateCachedPercent = 100, EstimateLongContext = true };
        Assert.Equal(.4m, AccountCostEstimate.Calculate(1_000_000, settings));
        Assert.Equal(2m, AccountCostEstimate.Calculate(1_000_000, settings with { EstimateModel = "gpt-6-astra" }));
    }

    [Fact]
    public void MissingTokensAndUnknownModelNeverBecomeFreeUsage()
    {
        Assert.Null(AccountCostEstimate.Calculate(null, new()));
        Assert.Null(AccountCostEstimate.Calculate(100, new() { EstimateModel = "unknown" }));
        Assert.Equal("Not reported", AccountCostEstimate.Format(null, new(), CultureInfo.InvariantCulture));
        Assert.Equal("≈$0.00 · 0 tokens", AccountCostEstimate.Format(0, new(), CultureInfo.InvariantCulture));
        Assert.StartsWith("≈<$0.01", AccountCostEstimate.Format(1, new(), CultureInfo.InvariantCulture), StringComparison.Ordinal);
    }

    [Fact]
    public void InvalidMixIsRejectedAndStoredSettingsRecover()
    {
        var settings = new AppSettings { EstimateCachedPercent = 90, EstimateOutputPercent = 20 };
        Assert.Null(AccountCostEstimate.Calculate(1_000_000, settings));
        Assert.Equal(4m, AccountCostEstimate.Calculate(1_000_000, SettingsStore.Validate(settings)));
    }

    [Fact]
    public void HugeTotalsDoNotOverflowIntegerMultiplication()
    {
        Assert.Equal(long.MaxValue / 1_000_000m * 4m, AccountCostEstimate.Calculate(long.MaxValue, new()));
    }

    [Fact]
    public async Task PricingAssumptionsPersistAcrossRestarts()
    {
        using var temporary = TemporaryDirectory.Create();
        var store = new SettingsStore(temporary.Paths);
        await store.SaveAsync(new() { EstimateModel = "gpt-6-astra", EstimateCachedPercent = 95, EstimateOutputPercent = 2 });
        var loaded = await new SettingsStore(temporary.Paths).LoadAsync();
        Assert.Equal("gpt-6-astra", loaded.EstimateModel);
        Assert.Equal(95, loaded.EstimateCachedPercent);
        Assert.Equal(2, loaded.EstimateOutputPercent);
    }
}

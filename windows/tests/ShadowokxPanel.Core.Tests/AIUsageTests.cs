using System.Text.Json;
using ShadowokxPanel.Core.AI;
using ShadowokxPanel.Core.Codex;
namespace ShadowokxPanel.Core.Tests;
public sealed class AIUsageTests
{
    private static AIUsage Parse(string json,string id="claude")
    { using var doc=JsonDocument.Parse(json);return AIUsageNormalizer.Normalize(doc.RootElement,id,DateTimeOffset.FromUnixTimeSeconds(1000)); }
    [Fact] public void QuotaChangesDoNotMeanWork()
    { var usage=Parse("""{"weekly":{"usedPercent":85}}""");Assert.Equal(85d,usage.Windows[0].UsedPercent);Assert.False(usage.IsWorking(DateTimeOffset.FromUnixTimeSeconds(1000))); }
    [Fact] public void ExpiredWindowsAreNotNewAllowance()
    { Assert.Throws<JsonException>(()=>Parse("""{"weekly":{"usedPercent":85,"resetsAt":999}}""")); }
    [Fact] public void ExplicitActivityExpires()
    {
        var usage=Parse("""{"totalTokens":1,"activity":{"active":true,"updatedAt":1000}}""");
        Assert.True(usage.IsWorking(DateTimeOffset.FromUnixTimeSeconds(1005)));
        Assert.False(usage.IsWorking(DateTimeOffset.FromUnixTimeSeconds(1031)));
    }
    [Fact] public void UntimestampedActivityIsIdle()
    { Assert.False(Parse("""{"totalTokens":1,"activity":{"active":true}}""").IsWorking(DateTimeOffset.FromUnixTimeSeconds(1000))); }
    [Fact] public void DeepSeekBalanceIsNotSubscriptionPercent()
    { var usage=Parse("""{"balance_infos":[{"total_balance":"12.50","currency":"USD"}]}""","deepseek");Assert.Empty(usage.Windows);Assert.Equal(12.5,usage.Balances[0].Amount); }
}

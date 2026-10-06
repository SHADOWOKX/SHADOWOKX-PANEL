using System.Globalization;
using System.Text.Json;
using ShadowokxPanel.Core.AI;
using ShadowokxPanel.Core.Presentation;

namespace ShadowokxPanel.Core.Tests;

public sealed class CommandCodeUsageTests
{
    private static JsonElement Json(string text)
    {
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }

    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-06T12:00:00Z", CultureInfo.InvariantCulture);
    private static long ResetMs(int minutes) => Now.AddMinutes(minutes).ToUnixTimeMilliseconds();

    private static (CommandCodeAccount Identity, JsonElement Credits, JsonElement Subscription, JsonElement Summary) Fixture()
    {
        var identity = CommandCodeUsage.ReadIdentity(Json(
            """{"data":{"user":{"userName":"tester"},"org":{"id":"org_1"}}}"""));
        var credits = Json(
            "{\"credits\":{\"monthlyCredits\":10,\"purchasedCredits\":2,\"freeCredits\":1,\"planId\":\"individual-goat\"}," +
            "\"windowLimits\":{\"fiveHour\":{\"used\":1,\"cap\":14,\"exceeded\":false,\"resetAt\":" + ResetMs(60) + "}," +
            "\"weekly\":{\"used\":5,\"cap\":35,\"resetAt\":" + ResetMs(600) + "}}}");
        var subscription = Json(
            """{"data":{"planId":"individual-goat","status":"active","currentPeriodStart":"2026-10-01T00:00:00Z","currentPeriodEnd":"2026-11-01T00:00:00Z"}}""");
        var summary = Json(
            """{"totalCount":12,"totalCredits":40,"totalMonthlyCredits":30,"totalPurchasedCredits":6,"totalFreeCredits":4,"periodBasis":"billing-period"}""");
        return (identity, credits, subscription, summary);
    }

    [Fact]
    public void ParsesVerifiedShapesAndIdentifiesGoat()
    {
        var (identity, credits, subscription, summary) = Fixture();
        var usage = CommandCodeUsage.Parse(identity, credits, subscription, summary, Now);
        Assert.Equal("tester", usage.Account);
        Assert.Equal("org_1", usage.OrgId);
        Assert.Equal("GOAT", usage.Plan);
        Assert.Equal("active", usage.PlanStatus);
        Assert.Equal(2, usage.Windows.Count);
        var weekly = usage.Windows.Single(window => window.Label == "Weekly allowance");
        Assert.Equal(5d, weekly.Used);
        Assert.Equal(35d, weekly.Cap);
        Assert.Equal(100d * 5 / 35, weekly.UsedPercent!.Value, 6);
        Assert.Equal(3, usage.CreditBalances.Count);
        Assert.Equal(40d, usage.Consumption.UsedCredits);
        Assert.Equal(12L, usage.Consumption.Requests);
        Assert.Equal("billing-period", usage.Consumption.PeriodBasis);
        Assert.NotNull(usage.Consumption.PeriodEnd);
        Assert.Equal(Now, usage.UpdatedAt);
    }

    [Fact]
    public void MissingUsedOrCapIsUnavailableNotZero()
    {
        // A window without both used and cap cannot become a percentage.
        var credits = Json("""{"windowLimits":{"weekly":{"used":5}}}""");
        Assert.Throws<CommandCodeException>(() =>
            CommandCodeUsage.Parse(new(null, null), credits, null, null, Now));
        // A zero cap keeps the window but leaves the percentage unavailable.
        var zero = Json("""{"windowLimits":{"weekly":{"used":0,"cap":0}}}""");
        var usage = CommandCodeUsage.Parse(new(null, null), zero, null, null, Now);
        Assert.Null(usage.Windows[0].UsedPercent);
    }

    [Fact]
    public void ExpiredWindowsAreDiscarded()
    {
        var credits = Json("{\"windowLimits\":{\"weekly\":{\"used\":5,\"cap\":35,\"resetAt\":" +
            Now.AddMinutes(-5).ToUnixTimeMilliseconds() + "},\"fiveHour\":{\"used\":1,\"cap\":14}}}");
        var usage = CommandCodeUsage.Parse(new(null, null), credits, null, null, Now);
        Assert.Single(usage.Windows);
        Assert.Equal("Five-hour allowance", usage.Windows[0].Label);
    }

    [Fact]
    public void UnsupportedOrMissingPayloadIsRejected()
    {
        Assert.Throws<CommandCodeException>(() =>
            CommandCodeUsage.Parse(new(null, null), Json("""{"unexpected":true}"""), null, null, Now));
        Assert.Throws<CommandCodeException>(() =>
            CommandCodeUsage.ReadIdentity(Json("""{"org":{"id":"x"}}""")));
        Assert.Throws<CommandCodeException>(() =>
            CommandCodeUsage.ReadIdentity(Json("""{"data":{"user":{"userName":"x"}},"success":false}""")));
    }

    [Fact]
    public void KeyValidationRejectsWhitespaceAndShortKeys()
    {
        Assert.Equal("abcdefgh", CommandCodeUsage.ValidateKey("abcdefgh"));
        Assert.Throws<CommandCodeException>(() => CommandCodeUsage.ValidateKey("short"));
        Assert.Throws<CommandCodeException>(() => CommandCodeUsage.ValidateKey("with space"));
        Assert.Throws<CommandCodeException>(() => CommandCodeUsage.ValidateKey(null));
    }

    [Fact]
    public void RetryAfterHonoursSecondsAndFallsBack()
    {
        Assert.Equal(Now.AddSeconds(60), CommandCodeUsage.RetryAfter("60", Now));
        Assert.Equal(Now.AddMinutes(3), CommandCodeUsage.RetryAfter("garbage", Now));
        Assert.Equal(Now.AddMinutes(3), CommandCodeUsage.RetryAfter(null, Now));
    }

    [Fact]
    public void CommandCodeUsageNeverBecomesMascotWork()
    {
        var (identity, credits, subscription, summary) = Fixture();
        var usage = AIUsage.FromCommandCode(CommandCodeUsage.Parse(identity, credits, subscription, summary, Now));
        Assert.Equal("commandcode-api", usage.Source);
        Assert.False(usage.IsWorking(Now));
        Assert.Equal(2, usage.Windows.Count);
        // Five-hour window: 1 / 14 used -> about 93% remaining.
        Assert.Equal(93d, AllowanceStatus.Remaining(usage.Windows[0].UsedPercent));
    }
}

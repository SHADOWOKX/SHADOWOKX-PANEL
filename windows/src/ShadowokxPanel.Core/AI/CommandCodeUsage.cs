using System.Globalization;
using System.Text;
using System.Text.Json;

namespace ShadowokxPanel.Core.AI;

// Verified read-only Command Code account fields. Unknown/malformed fields stay
// unavailable rather than being guessed or defaulted to zero.
public sealed class CommandCodeException : Exception
{
    public CommandCodeException(string code, DateTimeOffset? retryAt = null) : base(ErrorText(code))
    {
        Code = code;
        RetryAt = retryAt;
    }

    public string Code { get; }
    public DateTimeOffset? RetryAt { get; }
    public int? HttpStatus { get; set; }

    private static string ErrorText(string code) => code switch
    {
        "authentication-required" => "Add your Command Code API key in Settings.",
        "authentication-failed" => "Command Code rejected the API key. Update it in Settings.",
        "keyring-locked" => "The Windows credential store is locked, then retry Command Code.",
        "keyring-unavailable" => "Windows Credential Manager is unavailable. No plaintext fallback is used.",
        "keyring-write-failed" => "The API key could not be saved in Windows Credential Manager.",
        "invalid-key" => "Enter a valid API key without spaces.",
        "rate-limited" => "Command Code rate limit reached. Refresh will resume after the server retry time.",
        "network" => "Could not reach Command Code. The last successful values are marked stale.",
        "timeout" => "Command Code did not respond in time. Refresh will retry automatically.",
        "server" => "Command Code is temporarily unavailable. Refresh will retry automatically.",
        "api-changed" => "Command Code returned an unsupported usage response. Missing values are unavailable.",
        "cancelled" => "Command Code refresh was cancelled.",
        _ => "Command Code usage is unavailable.",
    };
}

public sealed record CommandCodeWindow(string Label, double Used, double Cap, double? UsedPercent,
    bool? Exceeded, DateTimeOffset? ResetsAt);
public sealed record CommandCodeCreditBalance(string Label, double Amount);
public sealed record CommandCodeConsumption(double? UsedCredits, double? MonthlyUsedCredits,
    double? PurchasedUsedCredits, double? FreeUsedCredits, long? Requests, string? PeriodBasis,
    DateTimeOffset? PeriodStart, DateTimeOffset? PeriodEnd);
public sealed record CommandCodeAccount(string? Account, string? OrgId);
public sealed record CommandCodeUsage(string? Account, string? OrgId, string? Plan, string? PlanId,
    string? PlanStatus, IReadOnlyList<CommandCodeWindow> Windows,
    IReadOnlyList<CommandCodeCreditBalance> CreditBalances, CommandCodeConsumption Consumption,
    DateTimeOffset UpdatedAt)
{
    public IReadOnlyList<string> Warnings { get; init; } = [];
    public DateTimeOffset? RetryAt { get; init; }

    // API keys are 8-4096 visible ASCII characters with no whitespace.
    public static string ValidateKey(string? key)
    {
        if (key is null || key.Length < 8 || key.Length > 4096)
            throw new CommandCodeException("invalid-key");
        foreach (var character in key)
            if (character < '\u0021' || character > '\u007e')
                throw new CommandCodeException("invalid-key");
        return key;
    }

    public static JsonElement DecodeResponse(byte[]? bytes)
    {
        if (bytes is null || bytes.Length > 1024 * 1024)
            throw new CommandCodeException("api-changed");
        try
        {
            var text = new UTF8Encoding(false, true).GetString(bytes);
            using var document = JsonDocument.Parse(text);
            return document.RootElement.Clone();
        }
        catch (Exception error) when (error is JsonException or DecoderFallbackException)
        {
            throw new CommandCodeException("api-changed");
        }
    }

    public static DateTimeOffset? Timestamp(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) &&
            double.IsFinite(number) && number > 0)
        {
            var milliseconds = number < 1e12 ? number * 1000 : number;
            try { return DateTimeOffset.FromUnixTimeMilliseconds((long)milliseconds); }
            catch (ArgumentOutOfRangeException) { return null; }
        }
        if (value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString()))
        {
            if (DateTimeOffset.TryParse(value.GetString(), CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed) &&
                parsed.ToUnixTimeMilliseconds() > 0)
                return parsed;
        }
        return null;
    }

    public static DateTimeOffset RetryAfter(string? value, DateTimeOffset now)
    {
        if (!string.IsNullOrWhiteSpace(value) && value.Trim().All(char.IsAsciiDigit) &&
            long.TryParse(value.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var seconds))
            return now.AddSeconds(Math.Max(1, seconds));
        if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var date) && date > now)
            return date;
        return now.AddMinutes(3);
    }

    public static CommandCodeAccount ReadIdentity(JsonElement whoami)
    {
        var data = CommandCodeJson.Get(whoami, "data");
        var root = CommandCodeJson.IsRecord(data) && CommandCodeJson.IsRecord(CommandCodeJson.Get(data, "user"))
            ? data : whoami;
        if (!CommandCodeJson.IsRecord(CommandCodeJson.Get(root, "user")) ||
            CommandCodeJson.Get(whoami, "success").ValueKind == JsonValueKind.False)
            throw new CommandCodeException("api-changed");
        var user = CommandCodeJson.Get(root, "user");
        return new(
            CommandCodeJson.Text(CommandCodeJson.Get(user, "userName")) ??
                CommandCodeJson.Text(CommandCodeJson.Get(user, "username")),
            CommandCodeJson.Text(CommandCodeJson.Get(CommandCodeJson.Get(root, "org"), "id")));
    }

    public static CommandCodeUsage Parse(CommandCodeAccount identity, JsonElement creditsResponse,
        JsonElement? subscriptionResponse, JsonElement? summaryResponse, DateTimeOffset now)
    {
        var root = CommandCodeJson.IsRecord(CommandCodeJson.Get(creditsResponse, "data"))
            ? CommandCodeJson.Get(creditsResponse, "data") : creditsResponse;
        if (!CommandCodeJson.IsRecord(root) ||
            CommandCodeJson.Get(creditsResponse, "success").ValueKind == JsonValueKind.False ||
            (!CommandCodeJson.IsRecord(CommandCodeJson.Get(root, "credits")) &&
                !CommandCodeJson.IsRecord(CommandCodeJson.Get(root, "windowLimits"))))
            throw new CommandCodeException("api-changed");

        var credits = CommandCodeJson.Get(root, "credits");
        var limits = CommandCodeJson.Get(root, "windowLimits");
        var subscription = subscriptionResponse is { } subscriptionValue
            ? CommandCodeJson.IsRecord(CommandCodeJson.Get(subscriptionValue, "data"))
                ? CommandCodeJson.Get(subscriptionValue, "data")
                : CommandCodeJson.IsRecord(CommandCodeJson.Get(subscriptionValue, "subscription"))
                    ? CommandCodeJson.Get(subscriptionValue, "subscription") : default
            : default;
        var summary = summaryResponse is { } summaryValue
            ? CommandCodeJson.IsRecord(CommandCodeJson.Get(summaryValue, "data"))
                ? CommandCodeJson.Get(summaryValue, "data")
                : CommandCodeJson.IsRecord(summaryValue) ? summaryValue : default
            : default;

        var windows = new List<CommandCodeWindow>();
        AddWindow(windows, "Five-hour allowance",
            CommandCodeJson.Coalesce(CommandCodeJson.Get(limits, "fiveHour"), CommandCodeJson.Get(limits, "five_hour")), now);
        AddWindow(windows, "Weekly allowance", CommandCodeJson.Get(limits, "weekly"), now);

        var planId = CommandCodeJson.Text(
            CommandCodeJson.Coalesce(CommandCodeJson.Get(subscription, "planId"),
                CommandCodeJson.Coalesce(CommandCodeJson.Get(subscription, "plan_id"),
                    CommandCodeJson.Coalesce(CommandCodeJson.Get(credits, "planId"),
                        CommandCodeJson.Get(credits, "plan_id")))));
        var plan = planId == "individual-goat" ? "GOAT" : planId;

        var creditBalances = new List<CommandCodeCreditBalance>();
        AddBalance(creditBalances, "Monthly credits remaining",
            CommandCodeJson.Coalesce(CommandCodeJson.Get(credits, "monthlyCredits"),
                CommandCodeJson.Get(credits, "monthly_credits")));
        AddBalance(creditBalances, "Purchased credits",
            CommandCodeJson.Coalesce(CommandCodeJson.Get(credits, "purchasedCredits"),
                CommandCodeJson.Get(credits, "purchased_credits")));
        AddBalance(creditBalances, "Free credits",
            CommandCodeJson.Coalesce(CommandCodeJson.Get(credits, "freeCredits"),
                CommandCodeJson.Get(credits, "free_credits")));
        if (windows.Count == 0 && creditBalances.Count == 0)
            throw new CommandCodeException("api-changed");

        var consumption = new CommandCodeConsumption(
            CommandCodeJson.Amount(CommandCodeJson.Get(summary, "totalCredits")),
            CommandCodeJson.Amount(CommandCodeJson.Get(summary, "totalMonthlyCredits")),
            CommandCodeJson.Amount(CommandCodeJson.Get(summary, "totalPurchasedCredits")),
            CommandCodeJson.Amount(CommandCodeJson.Get(summary, "totalFreeCredits")),
            CommandCodeJson.Count(CommandCodeJson.Get(summary, "totalCount")),
            CommandCodeJson.Text(CommandCodeJson.Get(summary, "periodBasis")),
            Timestamp(CommandCodeJson.Coalesce(CommandCodeJson.Get(subscription, "currentPeriodStart"),
                CommandCodeJson.Get(subscription, "current_period_start"))),
            Timestamp(CommandCodeJson.Coalesce(CommandCodeJson.Get(subscription, "currentPeriodEnd"),
                CommandCodeJson.Get(subscription, "current_period_end"))));
        return new(identity.Account, identity.OrgId, plan, planId,
            CommandCodeJson.Text(CommandCodeJson.Get(subscription, "status")),
            windows, creditBalances, consumption, now);
    }

    private static void AddWindow(List<CommandCodeWindow> windows, string label, JsonElement raw, DateTimeOffset now)
    {
        if (!CommandCodeJson.IsRecord(raw)) return;
        var used = CommandCodeJson.Amount(CommandCodeJson.Get(raw, "used"));
        var cap = CommandCodeJson.Amount(CommandCodeJson.Get(raw, "cap"));
        // Missing never means zero.
        if (used is null || cap is null) return;
        var resetsAt = Timestamp(CommandCodeJson.Coalesce(CommandCodeJson.Get(raw, "resetAt"),
            CommandCodeJson.Get(raw, "reset_at")));
        if (resetsAt is { } reset && reset <= now) return;
        double? percent = cap > 0 ? used / cap * 100 : null;
        bool? exceeded = CommandCodeJson.Get(raw, "exceeded").ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
        windows.Add(new(label, used.Value, cap.Value,
            percent is { } value && double.IsFinite(value) ? value : null, exceeded, resetsAt));
    }

    private static void AddBalance(List<CommandCodeCreditBalance> balances, string label, JsonElement value)
    {
        if (CommandCodeJson.Amount(value) is { } amount)
            balances.Add(new(label, amount));
    }
}

internal static class CommandCodeJson
{
    internal static JsonElement Get(JsonElement value, string name) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var result) ? result : default;

    internal static JsonElement Coalesce(JsonElement first, JsonElement second) =>
        first.ValueKind == JsonValueKind.Undefined ? second : first;

    internal static bool IsRecord(JsonElement value) => value.ValueKind == JsonValueKind.Object;

    internal static double? Amount(JsonElement value) =>
        value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) &&
        double.IsFinite(number) && number >= 0 ? number : null;

    internal static long? Count(JsonElement value) =>
        value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number) && number >= 0 ? number : null;

    internal static string? Text(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.String) return null;
        var text = value.GetString();
        return text is { Length: <= 160 } ? text : null;
    }
}

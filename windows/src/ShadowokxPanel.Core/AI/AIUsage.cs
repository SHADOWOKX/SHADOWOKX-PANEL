using System.Text.Json;
namespace ShadowokxPanel.Core.AI;

public sealed record AISource(string Path = "", string KeyFile = "");
public sealed record AIWindow(string Label, double UsedPercent, DateTimeOffset? ResetsAt);
public sealed record AIBalance(double Amount, string Currency);
public sealed record AIUsage(IReadOnlyList<AIWindow> Windows, IReadOnlyList<AIBalance> Balances,
    double? Tokens, string? Account, string? Plan, DateTimeOffset UpdatedAt,
    bool Active, DateTimeOffset? ActivityAt, DateTimeOffset? ExpiresAt)
{
    public bool IsWorking(DateTimeOffset now) => Active && ActivityAt <= now.AddSeconds(5) && ExpiresAt > now;
}
public static class AICatalog
{
    public static IReadOnlyDictionary<string, string> Providers { get; } = new Dictionary<string, string>
    {
        ["codex"] = "ChatGPT Codex", ["claude"] = "Claude", ["opencode"] = "OpenCode",
        ["commandcode"] = "Command Code", ["deepseek"] = "DeepSeek", ["glm"] = "GLM · Z.ai", ["gemini"] = "Gemini",
    };
    public static bool Contains(string? id) => id is not null && Providers.ContainsKey(id);
}
public static class AIUsageNormalizer
{
    private static JsonElement Get(JsonElement value, string key) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(key, out var result) ? result : default;
    private static double? Number(JsonElement value) => value.ValueKind == JsonValueKind.Number &&
        value.TryGetDouble(out var number) && double.IsFinite(number) ? number : null;
    private static string? Text(JsonElement value) => value.ValueKind == JsonValueKind.String ? value.GetString()?[..Math.Min(160, value.GetString()!.Length)] : null;
    private static DateTimeOffset? Time(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.String && DateTimeOffset.TryParse(value.GetString(),
            System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var parsed)) return parsed;
        if (Number(value) is not { } number || number <= 0) return null;
        try { return DateTimeOffset.FromUnixTimeMilliseconds((long)(number < 1e12 ? number * 1000 : number)); }
        catch (ArgumentOutOfRangeException) { return null; }
    }
    public static AIUsage Normalize(JsonElement raw, string id, DateTimeOffset now)
    {
        if (raw.ValueKind != JsonValueKind.Object) throw new JsonException("Usage source must be an object.");
        var windows = new List<AIWindow>();
        void Add(string label, JsonElement value)
        {
            var used = Number(Get(value,"usedPercent")) ?? Number(Get(value,"used_percentage")) ?? Number(Get(value,"utilization"));
            if (used is null && Number(Get(value,"remainingPercent")) is { } remaining) used = 100 - remaining;
            var reset = Time(Get(value,"resetsAt")) ?? Time(Get(value,"resets_at"));
            if (used is null || reset <= now) return;
            windows.Add(new(label, Math.Clamp(used.Value,0,100), reset));
        }
        if (Get(raw,"windows") is { ValueKind: JsonValueKind.Array } list)
            foreach (var value in list.EnumerateArray().Take(12)) Add(Text(Get(value,"label")) ?? "Allowance",value);
        else
        {
            var rate = Get(raw,"rate_limits"); if (rate.ValueKind != JsonValueKind.Object) rate = raw;
            Add("Five-hour allowance", Get(rate,"five_hour").ValueKind == JsonValueKind.Object ? Get(rate,"five_hour") : Get(rate,"fiveHour"));
            Add("Weekly allowance", Get(rate,"seven_day").ValueKind == JsonValueKind.Object ? Get(rate,"seven_day") : Get(rate,"weekly"));
            Add("Monthly allowance",Get(rate,"monthly")); Add("Spend allowance",Get(rate,"spend_limit"));
        }
        var balances = new List<AIBalance>();
        if (id == "deepseek" && Get(raw,"balance_infos") is { ValueKind: JsonValueKind.Array } items)
            foreach (var value in items.EnumerateArray().Take(8))
            {
                var amount = Number(Get(value,"total_balance"));
                if (amount is null && double.TryParse(Text(Get(value,"total_balance")),System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture,out var parsed) && double.IsFinite(parsed)) amount = parsed;
                if (amount is { } n) balances.Add(new(n,Text(Get(value,"currency")) ?? ""));
            }
        else if (Number(Get(Get(raw,"balance"),"amount")) is { } amount)
            balances.Add(new(amount,Text(Get(Get(raw,"balance"),"currency")) ?? ""));
        var tokens = Number(Get(Get(raw,"tokens"),"total")) ?? Number(Get(raw,"totalTokens"));
        if (windows.Count == 0 && balances.Count == 0 && tokens is null) throw new JsonException("No allowance, balance or token usage was reported.");
        var activity = Get(raw,"activity");
        var at = Time(Get(activity,"updatedAt")) ?? Time(Get(raw,"updatedAt"));
        var expiry = Time(Get(activity,"expiresAt")) ?? at?.AddSeconds(30);
        if (at is { } start && expiry > start.AddMinutes(2)) expiry = start.AddMinutes(2);
        return new(windows,balances,tokens is >= 0 ? tokens : null,Text(Get(raw,"account")),Text(Get(raw,"plan")),
            Time(Get(raw,"updatedAt")) ?? now,Get(activity,"active").ValueKind == JsonValueKind.True && at is not null,at,expiry);
    }
}

namespace ShadowokxPanel.Core.Codex;

public sealed record ApiTokenPrice(string Model, decimal Input, decimal CachedInput, decimal Output, decimal CacheWrite)
{
    public string SourceUrl => $"https://developers.openai.com/api/docs/models/{Model}";
    public decimal Rate(bool longContext, int category) => category switch
    {
        0 => Input * (longContext ? 2 : 1),
        1 => CachedInput * (longContext && Model == "gpt-6-astra" ? 2 : 1),
        2 => Output * (longContext ? 1.5m : 1),
        3 => CacheWrite * (longContext ? 2 : 1),
        _ => throw new ArgumentOutOfRangeException(nameof(category)),
    };
}

public static class ApiPriceCatalog
{
    public const string VerifiedDate = "2026-09-11";
    public static IReadOnlyList<ApiTokenPrice> Models { get; } = Array.AsReadOnly(new ApiTokenPrice[]
    {
        new("gpt-5.6-sol", 4m, .4m, 20m, 5m),
        new("gpt-6-astra", 10m, 1m, 50m, 12.5m),
        new("gpt-5.6-terra", 2m, .2m, 12m, 2.5m),
        new("gpt-5.6-luna", .2m, .02m, 1.2m, .25m),
    });
    public static ApiTokenPrice? Find(string? model) =>
        Models.FirstOrDefault(p => p.Model == (model == "gpt-5.6" ? "gpt-5.6-sol" : model));
}

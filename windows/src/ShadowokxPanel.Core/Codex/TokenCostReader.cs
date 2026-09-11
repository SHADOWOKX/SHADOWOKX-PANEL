using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ShadowokxPanel.Core.IO;
using ShadowokxPanel.Core.Storage;

namespace ShadowokxPanel.Core.Codex;

public sealed record CostAmount(decimal Dollars, long Tokens, long UnpricedTokens);
public sealed record TokenCostSummary(CostAmount Today, CostAmount Yesterday, CostAmount Last30Days,
    DateTimeOffset UpdatedAt, bool Partial);
public sealed record CostRecord(DateTimeOffset Time, string Key, string Model, long Input, long Cached, long Output, long Writes);
public sealed record CostFileCache(long Length, long Modified, IReadOnlyList<CostRecord> Records, bool Partial, long Offset = 0,
    string Model = "unknown", string Provider = "openai", string? Previous = null);

public sealed class TokenCostReader(ApplicationPaths paths, string? codexHome = null)
{
    // Same price snapshot as the Linux panel (2026-09-11), USD per million tokens.
    private static readonly Dictionary<string, decimal[]> Prices = new(StringComparer.Ordinal)
    {
        ["gpt-6-astra"] = [10, 1, 50, 12.5m],
        ["gpt-5.6-sol"] = [4, .4m, 20, 5],
        ["gpt-5.6"] = [4, .4m, 20, 5],
        ["gpt-5.6-terra"] = [2, .2m, 12, 2.5m],
        ["gpt-5.6-luna"] = [.2m, .02m, 1.2m, .25m],
    };
    internal long LastScanReadBytes { get; private set; }
    private readonly string _home = codexHome ?? Environment.GetEnvironmentVariable("CODEX_HOME") ??
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
    private readonly Dictionary<string, CostFileCache> _files = new(StringComparer.OrdinalIgnoreCase);

    public static decimal? Estimate(CostRecord record)
    {
        if (!Valid(record) || !Prices.TryGetValue(record.Model, out var price)) return null;
        var longer = record.Input > 272000;
        return ((record.Input - record.Cached - record.Writes) * price[0] * (longer ? 2 : 1) +
            record.Cached * price[1] * (longer && record.Model == "gpt-6-astra" ? 2 : 1) +
            record.Output * price[2] * (longer ? 1.5m : 1) + record.Writes * price[3] * (longer ? 2 : 1)) / 1_000_000;
    }

    public Task<TokenCostSummary> ReadAsync(CancellationToken cancellationToken = default) =>
        Task.Run(() => ScanAsync(cancellationToken), cancellationToken);

    private async Task<TokenCostSummary> ScanAsync(CancellationToken cancellationToken)
    {
        LastScanReadBytes = 0;
        var today = DateOnly.FromDateTime(DateTime.Now);
        var first = today.AddDays(-29);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var totals = new CostAmount(0, 0, 0);
        var current = totals;
        var yesterday = totals;
        var partial = false;
        var retained = 0;
        foreach (var folder in new[] { "sessions", "archived_sessions" })
        {
            var root = Path.Combine(_home, folder);
            if (!Directory.Exists(root)) continue;
            var options = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true,
                AttributesToSkip = FileAttributes.ReparsePoint, MaxRecursionDepth = 8 };
            foreach (var file in Directory.EnumerateFiles(root, "*.jsonl", options))
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (visited.Count >= 4096 || retained >= 50_000) { partial = true; break; }
                try
                {
                    var info = new FileInfo(file);
                    if (DateOnly.FromDateTime(info.LastWriteTime) < first) { _files.Remove(file); continue; }
                    visited.Add(file);
                    var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(file)));
                    var store = new JsonFileStore<CostFileCache>(Path.Combine(paths.Cache, "cost-v1", key + ".json"));
                    if (!_files.TryGetValue(file, out var cached))
                        cached = await store.ReadAsync(cancellationToken).ConfigureAwait(false);
                    if (cached?.Records is null || cached.Length != info.Length || cached.Modified != info.LastWriteTimeUtc.Ticks)
                    {
                        cached = await ParseAsync(file, info, cached, cancellationToken).ConfigureAwait(false);
                        try { await store.WriteAsync(cached, cancellationToken).ConfigureAwait(false); }
                        catch (IOException) { }
                        catch (UnauthorizedAccessException) { }
                    }
                    retained += cached.Records.Count;
                    _files[file] = cached;
                    partial |= cached.Partial;
                    foreach (var record in cached.Records)
                    {
                        if (!Valid(record)) { partial = true; continue; }
                        var date = DateOnly.FromDateTime(record.Time.LocalDateTime);
                        if (date < first || date > today || !seen.Add(record.Key)) continue;
                        var cost = Estimate(record);
                        var tokens = record.Input + record.Output;
                        var amount = new CostAmount(cost ?? 0, tokens, cost.HasValue ? 0 : tokens);
                        totals = Add(totals, amount);
                        if (date == today) current = Add(current, amount);
                        if (date == today.AddDays(-1)) yesterday = Add(yesterday, amount);
                    }
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
                { partial = true; }
            }
        }
        foreach (var file in _files.Keys.Where(key => !visited.Contains(key)).ToArray()) _files.Remove(file);
        return new TokenCostSummary(current, yesterday, totals, DateTimeOffset.Now, partial || totals.UnpricedTokens > 0);
    }

    private static bool Valid(CostRecord? record) => record is not null &&
        !string.IsNullOrEmpty(record.Key) && !string.IsNullOrEmpty(record.Model) &&
        record.Input is >= 0 and <= 1_000_000_000_000 && record.Cached is >= 0 and <= 1_000_000_000_000 &&
        record.Output is >= 0 and <= 1_000_000_000_000 && record.Writes is >= 0 and <= 1_000_000_000_000 &&
        record.Cached + record.Writes <= record.Input;

    private static CostAmount Add(CostAmount left, CostAmount right) =>
        new(left.Dollars + right.Dollars, left.Tokens + right.Tokens, left.UnpricedTokens + right.UnpricedTokens);

    private async Task<CostFileCache> ParseAsync(string path, FileInfo info, CostFileCache? previousFile, CancellationToken token)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete, 32 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        var append = previousFile is { Offset: > 0 } && info.Length > previousFile.Length;
        var offset = append ? previousFile!.Offset : 0;
        if (offset > 0) stream.Seek(offset, SeekOrigin.Begin);
        else
        {
            var bom = new byte[3];
            var count = await stream.ReadAsync(bom, token).ConfigureAwait(false);
            offset = count == 3 && bom[0] == 0xef && bom[1] == 0xbb && bom[2] == 0xbf ? 3 : 0;
            stream.Seek(offset, SeekOrigin.Begin);
        }
        var readStart = stream.Position;
        using var text = new StreamReader(stream);
        var reader = new BoundedLineReader(text, skipOversized: true);
        var model = append ? previousFile!.Model : "unknown";
        var provider = append ? previousFile!.Provider : "openai";
        string? previous = append ? previousFile!.Previous : null;
        var first = DateTime.Today.AddDays(-29);
        var records = append ? previousFile!.Records.Where(r => Valid(r) && r.Time.LocalDateTime.Date >= first).ToList() : [];
        var partial = append && previousFile!.Partial;
        try
        {
            while (await reader.ReadLineAsync(token).ConfigureAwait(false) is { } line)
            {
                if (!reader.LastLineTerminated) break; // Retry an unfinished append on the next scan.
                offset += reader.LastLineBytes;
                if (!line.Contains("\"token_count\"", StringComparison.Ordinal) &&
                    !line.Contains("\"turn_context\"", StringComparison.Ordinal) &&
                    !line.Contains("\"session_meta\"", StringComparison.Ordinal)) continue;
                try
                {
                    using var doc = JsonDocument.Parse(line);
                    var root = doc.RootElement;
                    if (!root.TryGetProperty("payload", out var payload)) continue;
                    var type = root.GetProperty("type").GetString();
                    if (type == "session_meta") provider = String(payload, "model_provider") ?? "openai";
                    if (type == "turn_context") model = String(payload, "model") ?? "unknown";
                    if (type != "event_msg" || String(payload, "type") != "token_count" ||
                        !payload.TryGetProperty("info", out var usageInfo) || usageInfo.ValueKind != JsonValueKind.Object ||
                        !usageInfo.TryGetProperty("total_token_usage", out var total) ||
                        !usageInfo.TryGetProperty("last_token_usage", out var usage)) continue;
                    var signature = Counts(total);
                    if (previous == signature) continue;
                    previous = signature;
                    if (!DateTimeOffset.TryParse(String(root, "timestamp"), out var timestamp)) continue;
                    if (timestamp.LocalDateTime.Date < DateTime.Today.AddDays(-29)) continue;
                    var input = Count(usage, "input_tokens");
                    var cached = Count(usage, "cached_input_tokens");
                    var output = Count(usage, "output_tokens");
                    var writes = Count(usage, "cache_write_input_tokens", 0);
                    if (input < 0 || cached < 0 || output < 0 || writes < 0 || cached + writes > input)
                    { partial = true; continue; }
                    var key = $"{timestamp:O}:{signature}:{Counts(usage)}";
                    records.Add(new CostRecord(timestamp, key, provider == "openai" ? model : provider + "/" + model,
                        input, cached, output, writes));
                    if (records.Count > 2000) { partial = true; records.RemoveRange(0, 100); }
                }
                catch (Exception error) when (error is JsonException or InvalidOperationException or KeyNotFoundException)
                { partial = true; }
            }
        }
        catch (InvalidDataException) { partial = true; }
        LastScanReadBytes += stream.Position - readStart;
        return new CostFileCache(info.Length, info.LastWriteTimeUtc.Ticks, records, partial || reader.SkippedOversized, offset, model, provider, previous);
    }

    private static string? String(JsonElement value, string name) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var property) &&
        property.ValueKind == JsonValueKind.String ? property.GetString() : null;
    private static long Count(JsonElement value, string name, long fallback = -1) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var property) &&
        property.ValueKind == JsonValueKind.Number && property.TryGetInt64(out var number) && number is >= 0 and <= 1_000_000_000_000
            ? number : fallback;
    private static string Counts(JsonElement value) =>
        $"{Count(value, "input_tokens")}:{Count(value, "cached_input_tokens")}:{Count(value, "output_tokens")}:{Count(value, "cache_write_input_tokens", 0)}";
}

using ShadowokxPanel.Core.IO;
using ShadowokxPanel.Core.Codex;
using ShadowokxPanel.Core.Presentation;
using System.Text.Json;

namespace ShadowokxPanel.Core.Tests;

public sealed class PerformanceRegressionTests
{
    [Theory]
    [InlineData(1)] [InlineData(1.25)] [InlineData(1.5)] [InlineData(2)] [InlineData(3)]
    public void PopupStaysInsideNegativeCoordinateMonitor(double scale)
    {
        var work = new ScreenRect(-2560, -200, 2560, 1400);
        var result = PopupPlacement.Calculate(work, new(-2560, -200, 2560, 1440), -45, 1220, scale, 430, 730);
        Assert.InRange(result.X, work.X, work.Right - result.Width);
        Assert.InRange(result.Y, work.Y, work.Bottom - result.Height);
        Assert.Equal(work.Bottom - (int)Math.Round(10 * scale), result.Bottom);
    }

    [Theory]
    [InlineData(0, 40, 1920, 1040, 960, 20)]
    [InlineData(40, 0, 1880, 1080, 20, 500)]
    [InlineData(0, 0, 1880, 1080, 1900, 500)]
    [InlineData(0, 0, 1920, 1080, 1900, 1078)]
    [InlineData(0, 0, 1, 1, 0, 0)]
    public void PopupHandlesAllTaskbarEdgesAndTinyWorkAreas(int x, int y, int w, int h, int ax, int ay)
    {
        var result = PopupPlacement.Calculate(new(x, y, w, h), new(0, 0, 1920, 1080), ax, ay, 1.5, 430, 730);
        Assert.InRange(result.X, x, x + w - result.Width);
        Assert.InRange(result.Y, y, y + h - result.Height);
    }

    [Fact]
    public async Task ProtocolReaderRejectsUnterminatedOversizedInputBeforeAllocatingWholeLine()
    {
        using var text = new StringReader(new string('x', 200_000));
        var reader = new BoundedLineReader(text, 10_000);
        await Assert.ThrowsAsync<InvalidDataException>(async () => await reader.ReadLineAsync());
    }

    [Fact]
    public async Task ProtocolReaderPreservesLinesAcrossBufferBoundaries()
    {
        var expected = new string('a', 9000);
        using var text = new StringReader(expected + "\r\n\nlast");
        var reader = new BoundedLineReader(text);
        Assert.Equal(expected, await reader.ReadLineAsync());
        Assert.Equal("", await reader.ReadLineAsync());
        Assert.Equal("last", await reader.ReadLineAsync());
        Assert.Null(await reader.ReadLineAsync());
    }

    [Fact]
    public async Task CancelledReaderStopsBeforeConsumingInput()
    {
        using var text = new StringReader("hello");
        using var stop = new CancellationTokenSource();
        stop.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
            await new BoundedLineReader(text).ReadLineAsync(stop.Token));
        Assert.Equal('h', text.Peek());
    }

    [Fact]
    public void PricingDiscountsCachedTokensAndDoesNotGuessUnknownModels()
    {
        var record = new CostRecord(DateTimeOffset.Now, "k", "gpt-5.6-sol", 100000, 90000, 1000, 0);
        Assert.Equal(.096m, TokenCostReader.Estimate(record));
        Assert.Null(TokenCostReader.Estimate(record with { Model = "unknown" }));
        Assert.Equal(6.175m, TokenCostReader.Estimate(record with
            { Model = "gpt-6-astra", Input = 300000, Cached = 0, Output = 1000, Writes = 20000 }));
    }

    [Fact]
    public async Task CostScanDeduplicatesForksReusesCacheAndObservesChangedFiles()
    {
        using var temporary = TemporaryDirectory.Create();
        var sessions = Path.Combine(temporary.Paths.Root, "sessions");
        Directory.CreateDirectory(sessions);
        var now = DateTimeOffset.Now;
        var context = "{\"type\":\"turn_context\",\"payload\":{\"model\":\"gpt-5.6-sol\"}}\n";
        string Row(int count) => JsonSerializer.Serialize(new {
            timestamp = now.ToString("O"), type = "event_msg", payload = new {
                type = "token_count", info = new {
                    total_token_usage = new { input_tokens = 1000 * count, cached_input_tokens = 500 * count, output_tokens = 100 * count },
                    last_token_usage = new { input_tokens = 1000, cached_input_tokens = 500, output_tokens = 100 }
                }
            }
        }) + "\n";
        var file = Path.Combine(sessions, "one.jsonl");
        await File.WriteAllTextAsync(file, context + Row(1) + Row(1));
        await File.WriteAllTextAsync(Path.Combine(sessions, "fork.jsonl"), context + Row(1));
        var reader = new TokenCostReader(temporary.Paths, temporary.Paths.Root);
        var first = await reader.ReadAsync();
        Assert.Equal(1100, first.Today.Tokens);
        Assert.Equal(.0042m, first.Today.Dollars);
        var cacheFiles = Directory.GetFiles(Path.Combine(temporary.Paths.Cache, "cost-v1"));
        var modified = cacheFiles.Select(File.GetLastWriteTimeUtc).ToArray();
        var second = await reader.ReadAsync();
        Assert.Equal(first.Today, second.Today);
        Assert.Equal(modified, cacheFiles.Select(File.GetLastWriteTimeUtc));
        await File.AppendAllTextAsync(file, Row(2));
        Assert.Equal(2200, (await reader.ReadAsync()).Today.Tokens);
        // A new reader reuses the persisted metadata; no conversation content is cached.
        Assert.Equal(2200, (await new TokenCostReader(temporary.Paths, temporary.Paths.Root).ReadAsync()).Today.Tokens);
    }
}

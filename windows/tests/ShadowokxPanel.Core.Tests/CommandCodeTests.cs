using ShadowokxPanel.Core.AI;
namespace ShadowokxPanel.Core.Tests;

public sealed class CommandCodeTests
{
    [Fact]
    public void DocumentationReferenceCannotBecomeAccountConsumption()
    {
        Assert.Equal("https://commandcode.ai/usage",CommandCodeReference.UsageUri.AbsoluteUri);
        var raw=System.Text.Json.JsonSerializer.SerializeToElement(CommandCodeReference.Goat);
        Assert.Throws<System.Text.Json.JsonException>(() => AIUsageNormalizer.Normalize(raw,"commandcode",DateTimeOffset.UtcNow));
    }
    [Theory]
    [InlineData("{\"authenticated\":true,\"apiKey\":\"private-key\"}", "authenticated")]
    [InlineData("{\"authenticated\":false}", "signed-out")]
    [InlineData("{\"authenticated\":true,\"error\":\"private-key\"}", "error")]
    [InlineData("{\"authenticated\":\"true\"}", "unsupported")]
    [InlineData("{\"balance\":10,\"tokens\":100}", "unsupported")]
    [InlineData("{private-key", "unsupported")]
    public void AuthenticationNeverBecomesUsageOrLeaksSecrets(string raw, string expected)
    {
        var status = CommandCodeStatus.Parse(raw);
        Assert.Equal(expected, status);
        Assert.DoesNotContain("private-key", CommandCodeStatus.Message(status), StringComparison.Ordinal);
        Assert.Contains("API key", CommandCodeStatus.Message(status), StringComparison.Ordinal);
        Assert.Equal(TimeSpan.FromMinutes(5), CommandCodeStatus.Interval);
    }
    [Fact]
    public void DiscoveryUsesWindowsNpmWithoutExecutingTheWindowsCommandShell()
    {
        using var directory = TemporaryDirectory.Create();
        var script = Path.Combine(directory.Root, "node_modules", "command-code", "dist", "index.mjs");
        Directory.CreateDirectory(Path.GetDirectoryName(script)!);
        File.WriteAllText(script, "");
        File.WriteAllText(Path.Combine(directory.Root, "node.exe"), "");
        var found = CommandCodeStatus.Discover(directory.Root, true);
        Assert.NotNull(found);
        Assert.Equal(script, found.Value.Script);
        Assert.EndsWith("node.exe", found.Value.Binary, StringComparison.Ordinal);
        Assert.Null(CommandCodeStatus.Discover("relative", true));
    }
    [Fact]
    public void LinuxDiscoveryAvoidsDesktopName()
    {
        // Deterministic POSIX fixture: no host paths, no real files, no OS checks.
        const string bin = "/home/tester/.local/bin";
        const string otherBin = "/usr/local/bin";
        var fileSystem = new FakePosixFileSystem()
            .Add(FakePosixFileSystem.Combine(bin, "command-code"))
            .Add(FakePosixFileSystem.Combine(otherBin, "cmd"));

        // The desktop application binary name must never be discovered as the CLI.
        Assert.Null(CommandCodeStatus.Discover(bin, windows: false,
            fileSystem.Exists, FakePosixFileSystem.IsAbsolute, FakePosixFileSystem.Combine));

        // A later PATH entry is searched and the CLI path is returned exactly, with no
        // script entry point (that behavior is Windows-only).
        var found = CommandCodeStatus.Discover($"{bin}:{otherBin}", windows: false,
            fileSystem.Exists, FakePosixFileSystem.IsAbsolute, FakePosixFileSystem.Combine);
        Assert.NotNull(found);
        var resolved = found!.Value;
        Assert.Equal(FakePosixFileSystem.Combine(otherBin, "cmd"), resolved.Binary);
        Assert.Null(resolved.Script);
    }
    [Fact]
    public async Task MissingProcessDoesNotExposeExceptionPaths()
    {
        var result = await CommandCodeStatus.ReadAsync(binary: Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")));
        Assert.Equal("error", result);
    }
    [Fact]
    public async Task LinuxProcessReadsAreBoundedAndCancellable()
    {
        if (OperatingSystem.IsWindows()) return;
        using var directory = TemporaryDirectory.Create();
        var executable = Path.Combine(directory.Root, "cmdc");
        await File.WriteAllTextAsync(executable,"#!/bin/sh\nprintf '{\"authenticated\":false}'\nexit 1\n");
        File.SetUnixFileMode(executable,UnixFileMode.UserRead|UnixFileMode.UserWrite|UnixFileMode.UserExecute);
        Assert.Equal("signed-out",await CommandCodeStatus.ReadAsync(binary:executable));
        await File.WriteAllTextAsync(executable,"#!/bin/sh\nexec sleep 20\n");
        Assert.Equal("error",await CommandCodeStatus.ReadAsync(binary:executable,timeout:TimeSpan.FromMilliseconds(100)));
        using var stop = new CancellationTokenSource(); stop.Cancel();
        Assert.Equal("error",await CommandCodeStatus.ReadAsync(binary:executable,cancellation:stop.Token));
        await File.WriteAllTextAsync(executable,"#!/bin/sh\nyes x | head -c 20000\n");
        Assert.Equal("error",await CommandCodeStatus.ReadAsync(binary:executable));
    }
}

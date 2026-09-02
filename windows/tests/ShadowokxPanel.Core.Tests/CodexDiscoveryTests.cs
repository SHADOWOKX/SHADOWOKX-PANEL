using ShadowokxPanel.Core.Codex;

namespace ShadowokxPanel.Core.Tests;

public sealed class CodexDiscoveryTests
{
    [Fact]
    public void PathTakesPriority()
    {
        var environment = EnvironmentWith(("PATH", @"D:\Tools;C:\Windows\System32"));
        var result = CodexDiscovery.Find(environment, path =>
            path.Equals(@"D:\Tools\codex.exe", StringComparison.OrdinalIgnoreCase));
        Assert.NotNull(result);
        Assert.Equal(@"D:\Tools\codex.exe", result.ExecutablePath);
        Assert.False(result.IsCommandShim);
    }

    [Fact]
    public void FindsCurrentUserNpmShimWithUnusualProfile()
    {
        var environment = EnvironmentWith(
            ("PATH", string.Empty),
            ("USERPROFILE", @"D:\People\A User Ω"),
            ("APPDATA", @"D:\People\A User Ω\Roaming"));
        var expected = @"D:\People\A User Ω\Roaming\npm\codex.cmd";
        var result = CodexDiscovery.Find(environment, path => path == expected);
        Assert.NotNull(result);
        Assert.Equal(expected, result.ExecutablePath);
        Assert.True(result?.IsCommandShim == true);
    }

    [Fact]
    public void FindsPnpmAndWindowsAppAliasLocations()
    {
        var environment = EnvironmentWith(
            ("PATH", string.Empty),
            ("LOCALAPPDATA", @"E:\Profiles\case\Local"));
        var expected = @"E:\Profiles\case\Local\pnpm\codex.exe";
        Assert.Equal(expected, CodexDiscovery.Find(environment, path => path == expected)?.ExecutablePath);
    }

    [Fact]
    public void MergesCurrentUserAndMachinePathWithProcessPath()
    {
        var environment = EnvironmentWith(("PATH", @"C:\Windows\System32"));
        var expected = @"D:\UserTools\codex.cmd";
        var result = CodexDiscovery.Find(
            environment,
            path => path == expected,
            [@"D:\UserTools", @"E:\MachineTools"]);
        Assert.NotNull(result);
        Assert.Equal(expected, result?.ExecutablePath);
        Assert.True(result?.IsCommandShim == true);
    }

    [Fact]
    public void FindsRegisteredAppPath()
    {
        var environment = EnvironmentWith(("PATH", string.Empty));
        var expected = @"E:\Apps\OpenAI\codex.exe";
        var result = CodexDiscovery.Find(
            environment,
            path => path == expected,
            appPathCandidates: [expected]);
        Assert.Equal(expected, result?.ExecutablePath);
    }

    [Fact]
    public void FindsKnownPerUserChatGptBundledLocation()
    {
        var environment = EnvironmentWith(
            ("PATH", string.Empty),
            ("LOCALAPPDATA", @"D:\Profiles\Local"));
        var expected = @"D:\Profiles\Local\Programs\ChatGPT\resources\codex\codex.exe";
        Assert.Equal(expected, CodexDiscovery.Find(environment, path => path == expected)?.ExecutablePath);
    }

    [Fact]
    public void FindsOfficialWindowsStandaloneInstallerLocation()
    {
        var environment = EnvironmentWith(
            ("PATH", string.Empty),
            ("LOCALAPPDATA", @"D:\Profiles\Local"));
        var expected = @"D:\Profiles\Local\Programs\OpenAI\Codex\bin\codex.exe";
        Assert.Equal(expected, CodexDiscovery.Find(environment, path => path == expected)?.ExecutablePath);
    }

    [Fact]
    public void MissingInstallationReturnsNull()
    {
        Assert.Null(CodexDiscovery.Find(EnvironmentWith(("PATH", string.Empty)), _ => false));
    }

    [Fact]
    public void UnsafeCommandShimPathIsRejected()
    {
        var environment = EnvironmentWith(("PATH", @"C:\Users\A&Run\bin"));
        Assert.Null(CodexDiscovery.Find(environment, path =>
            path.EndsWith("codex.cmd", StringComparison.OrdinalIgnoreCase)));
    }

    private static Dictionary<string, string?> EnvironmentWith(params (string Key, string? Value)[] values)
    {
        var environment = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var (key, value) in values)
            environment[key] = value;
        return environment;
    }
}

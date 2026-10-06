using ShadowokxPanel.Core.AI;

namespace ShadowokxPanel.Core.Tests;

public sealed class CommandCodeIdentityTests
{
    [Fact]
    public void DesktopMainAndHelpersAreDistinguished()
    {
        const string exe = @"C:\Users\u\AppData\Local\Programs\Command Code\Command Code.exe";
        Assert.Equal("desktop-main", CommandCodeIdentity.ProcessRole("Command Code", exe, []));
        Assert.Equal("desktop-helper", CommandCodeIdentity.ProcessRole("Command Code", exe, ["--type=renderer"]));
        Assert.Equal("desktop-helper", CommandCodeIdentity.ProcessRole("Command Code", exe, ["--type=gpu-process"]));
    }

    [Fact]
    public void TheWindowsCommandShellIsNeverCommandCode()
    {
        Assert.Null(CommandCodeIdentity.ProcessRole("cmd", @"C:\Windows\System32\cmd.exe", []));
        Assert.Null(CommandCodeIdentity.ProcessRole("cmd.exe", @"C:\Windows\System32\cmd.exe", ["/c", "echo hi"]));
        Assert.False(CommandCodeIdentity.IsCandidate(@"C:\Windows\System32\cmd.exe", ["/c", "dir"]));
    }

    [Fact]
    public void BareCliLauncherRequiresTheNpmSignature()
    {
        Assert.Null(CommandCodeIdentity.ProcessRole("cmdc", @"C:\Users\u\AppData\Roaming\npm\cmdc.cmd", []));
        Assert.Equal("cli", CommandCodeIdentity.ProcessRole("node", @"C:\Program Files\nodejs\node.exe",
            [@"C:\Users\u\AppData\Roaming\npm\node_modules\command-code\dist\cli.mjs"]));
        Assert.Equal("cli", CommandCodeIdentity.ProcessRole("node", @"C:\Program Files\nodejs\node.exe",
            [@"C:\Users\u\AppData\Roaming\npm\node_modules\@commandcode\desktop\out\main\index.js"]));
    }

    [Fact]
    public void ElectronBundleArgumentsIdentifyTheDesktopApp()
    {
        Assert.Equal("desktop-main", CommandCodeIdentity.ProcessRole("electron",
            @"C:\Program Files\Electron\electron.exe",
            [@"C:\Program Files\Electron\electron.exe", @"--app-path=C:\apps\Command Code\resources\app"]));
        Assert.True(CommandCodeIdentity.IsApplication(appId: "command-code"));
        Assert.True(CommandCodeIdentity.IsApplication(appId: "com.commandcode.app"));
        Assert.False(CommandCodeIdentity.IsApplication(appId: "com.apple.Safari"));
        Assert.False(CommandCodeIdentity.IsApplication(executable: @"C:\Windows\explorer.exe"));
    }

    [Fact]
    public void PresenceIsEvidenceBasedAndNeverIncludesHelpersOnly()
    {
        var monitor = new CommandCodeProcessMonitor(new FakeSource(
        [
            new("Command Code", @"C:\...\Command Code.exe", ["--type=renderer"], false),
        ]));
        Assert.False(monitor.Sample().Open);
        Assert.Equal("electron-helper", monitor.Sample().Source);

        var visible = new CommandCodeProcessMonitor(new FakeSource(
        [
            new("Command Code", @"C:\...\Command Code.exe", [], true),
            new("Command Code", @"C:\...\Command Code.exe", ["--type=renderer"], false),
        ]));
        Assert.True(visible.Sample().Open);
        Assert.Equal("desktop-app", visible.Sample().Source);
    }

    private sealed class FakeSource(IReadOnlyList<CommandCodeProcessSnapshot> snapshots) : ICommandCodeProcessSource
    {
        public IReadOnlyList<CommandCodeProcessSnapshot> Capture() => snapshots;
    }
}

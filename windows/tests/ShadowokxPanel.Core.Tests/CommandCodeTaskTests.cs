using ShadowokxPanel.Core.AI;

namespace ShadowokxPanel.Core.Tests;

public sealed class CommandCodeTaskTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "shadowokx-cc-tasks", Guid.NewGuid().ToString("N"));
    private readonly string _log;

    public CommandCodeTaskTests()
    {
        Directory.CreateDirectory(_directory);
        _log = Path.Combine(_directory, "main.log");
    }

    private static string Running(string session) =>
        $"[2026-01-01 00:00:00.000] [info]  [send] turn running {{\"sessionId\":\"{session}\",\"chars\":10,\"images\":0}}\n";

    private static string Resolved(string session, string reason = "end_turn") =>
        $"[2026-01-01 00:00:05.000] [info]  [send] turn resolved {{\"sessionId\":\"{session}\",\"stopReason\":\"{reason}\",\"pendingSteers\":[]}}\n";

    private void Append(string text) => File.AppendAllText(_log, text);

    [Fact]
    public async Task RunningThenResolvedTracksOneTurn()
    {
        var monitor = new CommandCodeTaskMonitor(_log, () => DateTimeOffset.Parse("2026-01-01T00:00:06Z", System.Globalization.CultureInfo.InvariantCulture));
        Append(Running("s1"));
        await monitor.RefreshAsync();
        Assert.True(monitor.Current.Busy);
        Assert.Equal(CommandCodeTaskMonitor.TaskSource, monitor.Current.Source);
        Assert.NotNull(monitor.Current.StartedAt);
        Append(Resolved("s1"));
        await monitor.RefreshAsync();
        Assert.False(monitor.Current.Busy);
        Assert.Null(monitor.Current.Source);
    }

    [Fact]
    public async Task InterruptedAndErrorStopTheAnimation()
    {
        var monitor = new CommandCodeTaskMonitor(_log, () => DateTimeOffset.Parse("2026-01-01T00:00:06Z", System.Globalization.CultureInfo.InvariantCulture));
        Append(Running("s1"));
        await monitor.RefreshAsync();
        Assert.True(monitor.Current.Busy);
        Append(Resolved("s1", "run_error"));
        await monitor.RefreshAsync();
        Assert.False(monitor.Current.Busy);
    }

    [Fact]
    public async Task ClosingTheApplicationClearsAnyTrackedTurn()
    {
        var monitor = new CommandCodeTaskMonitor(_log, () => DateTimeOffset.Parse("2026-01-01T00:00:06Z", System.Globalization.CultureInfo.InvariantCulture));
        monitor.SetApplicationOpen(true);
        Append(Running("s1"));
        await monitor.RefreshAsync();
        Assert.True(monitor.Current.Busy);
        monitor.SetApplicationOpen(false);
        Assert.False(monitor.Current.Busy);
    }

    [Fact]
    public async Task LogRotationClearsInFlightTurns()
    {
        var monitor = new CommandCodeTaskMonitor(_log, () => DateTimeOffset.Parse("2026-01-01T00:00:06Z", System.Globalization.CultureInfo.InvariantCulture));
        Append(Running("s1"));
        await monitor.RefreshAsync();
        Assert.True(monitor.Current.Busy);
        File.WriteAllText(_log, string.Empty);
        await monitor.RefreshAsync();
        Assert.False(monitor.Current.Busy);
    }

    [Fact]
    public async Task AnAbandonedTurnExpires()
    {
        var now = DateTimeOffset.Parse("2026-01-01T00:00:06Z", System.Globalization.CultureInfo.InvariantCulture);
        var monitor = new CommandCodeTaskMonitor(_log, () => now, TimeSpan.FromMinutes(1));
        Append(Running("s1"));
        await monitor.RefreshAsync();
        Assert.True(monitor.Current.Busy);
        now = now.AddMinutes(2);
        await monitor.RefreshAsync();
        Assert.False(monitor.Current.Busy);
    }

    [Fact]
    public void TheWindowsLogPathIsTheElectronLogLocation()
    {
        var candidates = CommandCodePaths.DesktopLogCandidates();
        Assert.NotEmpty(candidates);
        Assert.All(candidates, candidate => Assert.EndsWith(Path.Combine("logs", "main.log"), candidate, StringComparison.Ordinal));
    }

    public void Dispose()
    {
        try { Directory.Delete(_directory, true); }
        catch (IOException) { }
    }
}

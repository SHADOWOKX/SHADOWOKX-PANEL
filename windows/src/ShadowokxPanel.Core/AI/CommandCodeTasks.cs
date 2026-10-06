using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace ShadowokxPanel.Core.AI;

// Windows Command Code Desktop data/log directory. Electron's app.getPath("logs")
// resolves to <userData>\logs, and userData is <productName> ("Command Code"), so
// the deterministic turn-lifecycle log is:
//     %APPDATA%\Command Code\logs\main.log
// The same electron-log file transport is used on Linux, where it was verified at
// ~/.config/Command Code/logs/main.log. Candidate roots are checked so a renamed
// install still resolves; the first existing file wins.
public static class CommandCodePaths
{
    public static IReadOnlyList<string> DesktopLogCandidates()
    {
        var candidates = new List<string>();
        foreach (var root in new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        })
        {
            if (string.IsNullOrWhiteSpace(root)) continue;
            foreach (var name in new[] { "Command Code", "command-code", "CommandCode", "@commandcodedesktop" })
                candidates.Add(Path.Combine(root, name, "logs", "main.log"));
        }
        return candidates;
    }

    public static string FindDesktopLog()
    {
        var candidates = DesktopLogCandidates();
        foreach (var candidate in candidates)
        {
            try { if (File.Exists(candidate)) return candidate; }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException) { }
        }
        return candidates.Count > 0 ? candidates[0] : Path.Combine("Command Code", "logs", "main.log");
    }
}

public sealed record CommandCodeTaskState(bool Busy, string? Source, DateTimeOffset? StartedAt);

// Real task activity for the panel. Application presence is NOT a task. This
// observer watches the one deterministic in-flight signal the desktop app writes
// about itself (electron-log, via the app's trace()):
//     start: [send] turn running  {"sessionId":"...","chars":N,"images":N}
//     end:   [send] turn resolved {"sessionId":"...","stopReason":"end_turn|interrupted|run_error"}
// The desktop main process emits these around instance.runTurn(), so one user turn
// (including every tool call inside its agent loop) is one start/end pair. There is
// no token-level logging, so BUSY never flickers.
public sealed partial class CommandCodeTaskMonitor : IDisposable
{
    public const int PollSeconds = 1;
    public const string TaskSource = "desktop-turn";
    // A turn that never logs a terminal line (app killed mid-run) is dropped so it
    // can never keep the mascot animating indefinitely.
    public static readonly TimeSpan DefaultMaxTask = TimeSpan.FromMinutes(45);
    private const int MaxPendingBytes = 1024 * 1024;

    private readonly Func<DateTimeOffset> _now;
    private readonly TimeSpan _maxTask;
    private readonly Dictionary<string, DateTimeOffset> _running = new(StringComparer.Ordinal);
    private byte[] _pending = [];
    private long _offset;
    private bool _applicationOpen;
    private bool _disposed;
    private Task? _inFlight;
    private CommandCodeTaskState _state = new(false, null, null);

    public CommandCodeTaskMonitor(string? logPath = null, Func<DateTimeOffset>? now = null,
        TimeSpan? maxTask = null)
    {
        LogPath = logPath ?? CommandCodePaths.FindDesktopLog();
        _now = now ?? (() => DateTimeOffset.UtcNow);
        _maxTask = maxTask ?? DefaultMaxTask;
    }

    public event EventHandler<CommandCodeTaskState>? Changed;

    public string LogPath { get; }
    public CommandCodeTaskState Current => _state;

    public void SetApplicationOpen(bool open)
    {
        if (open == _applicationOpen) return;
        _applicationOpen = open;
        if (!open)
        {
            _running.Clear();
            Publish();
        }
    }

    public Task RefreshAsync()
    {
        if (_disposed) return Task.CompletedTask;
        if (_inFlight is not null) return _inFlight;
        var task = ReadAsync();
        _inFlight = task;
        _ = task.ContinueWith(_ => { if (ReferenceEquals(_inFlight, task)) _inFlight = null; },
            CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        return task;
    }

    private async Task ReadAsync()
    {
        if (_disposed) return;
        long size;
        try
        {
            var info = new FileInfo(LogPath);
            if (!info.Exists) return;
            size = info.Length;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        {
            return;
        }
        // Log rotation/truncation: the app restarted, so no turn is in flight.
        if (size < _offset)
        {
            _offset = 0;
            _pending = [];
            _running.Clear();
        }
        if (size == _offset)
        {
            Expire();
            Publish();
            return;
        }
        try
        {
            await using var stream = new FileStream(LogPath, FileMode.Open, FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete, 4096, FileOptions.Asynchronous);
            stream.Seek(_offset, SeekOrigin.Begin);
            using var buffer = new MemoryStream();
            var chunk = new byte[65536];
            int read;
            while (!_disposed && (read = await stream.ReadAsync(chunk).ConfigureAwait(false)) > 0)
            {
                _offset += read;
                buffer.Write(chunk, 0, read);
            }
            var appended = buffer.ToArray();
            var merged = new byte[_pending.Length + appended.Length];
            _pending.CopyTo(merged, 0);
            appended.CopyTo(merged, _pending.Length);
            Consume(merged);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        Expire();
        Publish();
    }

    // A trailing partial line is kept as bytes so a split UTF-8 sequence survives
    // to the next poll.
    private void Consume(byte[] merged)
    {
        var lastNewline = -1;
        for (var index = merged.Length - 1; index >= 0; index--)
        {
            if (merged[index] == 0x0a) { lastNewline = index; break; }
        }
        if (lastNewline < 0)
        {
            _pending = merged.Length > MaxPendingBytes ? [] : merged;
            return;
        }
        var text = Encoding.UTF8.GetString(merged, 0, lastNewline);
        foreach (var line in text.Split('\n'))
            ConsumeLine(line);
        _pending = merged[lastNewline..];
    }

    private void ConsumeLine(string line)
    {
        var start = TurnStart().Match(line);
        if (start.Success)
        {
            _running[start.Groups[1].Value] = LineTime(line);
            return;
        }
        var end = TurnEnd().Match(line);
        if (end.Success)
            _running.Remove(end.Groups[1].Value);
    }

    private DateTimeOffset LineTime(string line)
    {
        var match = LineTimestamp().Match(line);
        if (match.Success && DateTimeOffset.TryParseExact(match.Groups[1].Value, "yyyy-MM-dd HH:mm:ss.fff",
            CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed))
            return parsed;
        return _now();
    }

    private void Expire()
    {
        var now = _now();
        foreach (var (sessionId, startedAt) in _running.ToArray())
            if (now - startedAt > _maxTask)
                _running.Remove(sessionId);
    }

    private void Publish()
    {
        if (_disposed) return;
        DateTimeOffset? startedAt = null;
        foreach (var value in _running.Values)
            startedAt = startedAt is null || value < startedAt ? value : startedAt;
        var busy = _running.Count > 0;
        var next = new CommandCodeTaskState(busy, busy ? TaskSource : null, startedAt);
        if (next == _state) return;
        _state = next;
        Changed?.Invoke(this, next);
    }

    [GeneratedRegex("\\[send\\] turn running \\{\"sessionId\":\"([^\"]+)\"")]
    private static partial Regex TurnStart();

    [GeneratedRegex("\\[send\\] turn resolved \\{\"sessionId\":\"([^\"]+)\"")]
    private static partial Regex TurnEnd();

    [GeneratedRegex("^\\[(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3})\\]")]
    private static partial Regex LineTimestamp();

    public void Dispose()
    {
        _disposed = true;
        _running.Clear();
    }
}

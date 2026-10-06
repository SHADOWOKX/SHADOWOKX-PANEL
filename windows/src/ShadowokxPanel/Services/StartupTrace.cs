using System.Globalization;
using System.Security;
using System.Text;

namespace ShadowokxPanel.Services;

// Deterministic startup tracing that works before WinUI, AppHost or any window exists.
// Writes synchronously to %LOCALAPPDATA%\ShadowokxPanel\startup.log (falling back to
// %TEMP%) and mirrors each line into the pre-existing StartupDiagnostics log. It is
// intentionally independent of every other logging path and never throws.
internal static class StartupTrace
{
    private const long MaximumBytes = 512 * 1024;
    private static readonly object Sync = new();
    private static string? _primary;
    private static string? _fallback;
    private static bool _resolved;

    internal static string LogPath
    {
        get { lock (Sync) return Resolve() ?? "(unavailable)"; }
    }

    internal static void Begin(string[] arguments)
    {
        Write("process started");
        Write(FormattableString.Invariant($"pid: {Environment.ProcessId}"));
        Write($"exe: {Safe(() => Environment.ProcessPath)}");
        Write($"args: {string.Join(' ', arguments)}");
        Write($"cwd: {Safe(() => Environment.CurrentDirectory)}");
        Write($"os: {Safe(() => FormattableString.Invariant($"{Environment.OSVersion}"))} 64bit={Environment.Is64BitProcess}");
        Write($"localappdata: {Safe(() => Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData))}");
        Write($"log: {LogPath}");
    }

    internal static void Write(string stage)
    {
        var line = string.Format(CultureInfo.InvariantCulture, "{0:O} [Startup] {1}{2}",
            DateTimeOffset.UtcNow, stage, Environment.NewLine);
        lock (Sync)
        {
            AppendAll(line);
        }
        StartupDiagnostics.Write(stage);
    }

    internal static void Exit(string reason) => Write($"EXIT reason: {reason}");

    internal static void Failure(string stage, Exception error)
    {
        ArgumentNullException.ThrowIfNull(error);
        Write($"{stage}: {error.GetType().FullName}: {error.Message}");
        var text = new StringBuilder();
        var current = error;
        for (var depth = 0; current is not null && depth < 8; depth++)
        {
            text.AppendLine(string.Format(CultureInfo.InvariantCulture,
                "--- exception depth {0}: {1}", depth, current.GetType().FullName));
            text.AppendLine(current.Message);
            text.AppendLine(current.StackTrace ?? "<no stack>");
            if (ReferenceEquals(current, current.InnerException))
                break;
            current = current.InnerException;
        }
        lock (Sync)
        {
            AppendAll(text.ToString());
        }
        StartupDiagnostics.Write($"{stage} details:{Environment.NewLine}{text}");
    }

    private static void AppendAll(string text)
    {
        var primary = Resolve();
        if (primary is not null && TryAppend(primary, text))
            return;
        if (_fallback is not null && TryAppend(_fallback, text))
            return;
        StartupDiagnostics.Write("StartupTrace could not write to disk.");
    }

    private static bool TryAppend(string path, string text)
    {
        try
        {
            var directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(directory))
                Directory.CreateDirectory(directory);
            if (File.Exists(path) && new FileInfo(path).Length > MaximumBytes)
                File.Move(path, path + ".old", true);
            File.AppendAllText(path, text, Encoding.UTF8);
            return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or
            SecurityException or NotSupportedException or ArgumentException)
        {
            return false;
        }
    }

    private static string? Resolve()
    {
        if (_resolved)
            return _primary ?? _fallback;
        _resolved = true;
        try
        {
            var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (!string.IsNullOrWhiteSpace(root))
                _primary = Path.Combine(root, "ShadowokxPanel", "startup.log");
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException) { }
        try
        {
            _fallback = Path.Combine(Path.GetTempPath(), "ShadowokxPanel-startup.log");
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException) { }
        return _primary ?? _fallback;
    }

    private static string Safe(Func<string?> probe)
    {
        try
        {
            return probe() ?? "<null>";
        }
        catch (Exception error)
        {
            return $"<{error.GetType().Name}>";
        }
    }
}

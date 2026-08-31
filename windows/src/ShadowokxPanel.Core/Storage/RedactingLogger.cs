using System.Text.Json;
using System.Text.RegularExpressions;
using System.Diagnostics.CodeAnalysis;

namespace ShadowokxPanel.Core.Storage;

[SuppressMessage("Design", "CA1001:Types that own disposable fields should be disposable",
    Justification = "SemaphoreSlim does not allocate a wait handle unless AvailableWaitHandle is used, which this process-lifetime logger never does.")]
public sealed partial class RedactingLogger(ApplicationPaths paths, Func<bool> enabled)
{
    private readonly SemaphoreSlim _gate = new(1, 1);

    public async Task DebugAsync(string eventName, object? details = null)
    {
        if (!enabled())
            return;
        var safeEvent = ControlCharacters().Replace(eventName ?? string.Empty, string.Empty);
        var line = $"{DateTimeOffset.Now:O} {safeEvent}";
        if (details is not null)
            line += " " + Redact(JsonSerializer.Serialize(details));

        await _gate.WaitAsync().ConfigureAwait(false);
        try
        {
            Directory.CreateDirectory(paths.Logs);
            var logPath = Path.Combine(paths.Logs, "shadowokx-panel.log");
            if (File.Exists(logPath) && new FileInfo(logPath).Length > 512 * 1024)
                File.Move(logPath, logPath + ".old", true);
            await File.AppendAllTextAsync(logPath, line + Environment.NewLine).ConfigureAwait(false);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // Logging is optional and must never affect the application.
        }
        finally
        {
            _gate.Release();
        }
    }

    internal static string Redact(string value) =>
        SecretLike().Replace(Bearer().Replace(value, "Bearer [redacted]"), "[redacted]");

    [GeneratedRegex("[\\u0000-\\u001f\\u007f]")]
    private static partial Regex ControlCharacters();

    [GeneratedRegex("(?i)\\bBearer\\s+\\S+")]
    private static partial Regex Bearer();

    [GeneratedRegex("(?i)\\b(?:sk-[A-Za-z0-9_-]{8,}|(?:access|refresh|auth)[_-]?token\\s*[:=]\\s*[^,}\\s]+)")]
    private static partial Regex SecretLike();
}

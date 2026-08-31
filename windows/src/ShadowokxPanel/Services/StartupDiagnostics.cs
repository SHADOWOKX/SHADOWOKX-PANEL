using System.Globalization;
using System.Security;
using System.Text;
using System.Text.RegularExpressions;

namespace ShadowokxPanel.Services;

internal static partial class StartupDiagnostics
{
    private const long MaximumLogBytes = 512 * 1024;
    private const int MaximumMessageCharacters = 16 * 1024;
    private static readonly object Sync = new();

    internal static void Write(string stage)
    {
        try
        {
            var safeStage = Redact(stage);
            if (safeStage.Length > MaximumMessageCharacters)
                safeStage = safeStage[..MaximumMessageCharacters];
            var line = string.Format(
                CultureInfo.InvariantCulture,
                "{0:O} pid={1} {2}{3}",
                DateTimeOffset.UtcNow,
                Environment.ProcessId,
                safeStage,
                Environment.NewLine);
            lock (Sync)
            {
                var path = Path.Combine(Path.GetTempPath(), "ShadowokxPanel-startup.log");
                if (File.Exists(path) && new FileInfo(path).Length > MaximumLogBytes)
                    File.Move(path, path + ".old", true);
                File.AppendAllText(path, line, Encoding.UTF8);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or
            SecurityException or NotSupportedException or ArgumentException)
        {
            // Early diagnostics must never become a startup dependency.
        }
    }

    internal static void WriteException(string stage, Exception error) =>
        Write($"{stage}: {error}");

    private static string Redact(string value)
    {
        var redacted = SecretLike().Replace(
            Bearer().Replace(value ?? string.Empty, "Bearer [redacted]"),
            "[redacted]");
        return ReplaceKnownPath(
            ReplaceKnownPath(
                ReplaceKnownPath(
                    redacted,
                    Path.GetTempPath(),
                    "%TEMP%\\"),
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "%LOCALAPPDATA%"),
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "%USERPROFILE%");
    }

    private static string ReplaceKnownPath(string value, string path, string replacement) =>
        string.IsNullOrWhiteSpace(path)
            ? value
            : value.Replace(path, replacement, StringComparison.OrdinalIgnoreCase);

    [GeneratedRegex("(?i)\\bBearer\\s+\\S+")]
    private static partial Regex Bearer();

    [GeneratedRegex("(?i)\\b(?:sk-[A-Za-z0-9_-]{8,}|(?:access|refresh|auth)[_-]?token\\s*[:=]\\s*[^,}\\s]+)")]
    private static partial Regex SecretLike();
}

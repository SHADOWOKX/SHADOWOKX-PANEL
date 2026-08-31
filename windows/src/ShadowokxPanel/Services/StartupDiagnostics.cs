using System.Collections;
using System.Globalization;
using System.Security;
using System.Text;
using System.Text.RegularExpressions;

namespace ShadowokxPanel.Services;

internal static partial class StartupDiagnostics
{
    private const long MaximumLogBytes = 512 * 1024;
    private const int MaximumMessageCharacters = 64 * 1024;
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

    internal static void WriteException(string stage, Exception error)
    {
        ArgumentNullException.ThrowIfNull(error);
        var details = new StringBuilder(stage);
        AppendException(details, error, "exception", 0, new HashSet<Exception>(
            ReferenceEqualityComparer.Instance));
        Write(details.ToString());
    }

    private static void AppendException(
        StringBuilder details,
        Exception error,
        string label,
        int depth,
        ISet<Exception> visited)
    {
        if (depth >= 12)
        {
            details.AppendLine().Append(label).Append("=<maximum exception depth reached>");
            return;
        }
        if (!visited.Add(error))
        {
            details.AppendLine().Append(label).Append("=<exception cycle>");
            return;
        }

        details.AppendLine().Append(label).Append(".type=")
            .Append(error.GetType().FullName ?? error.GetType().Name);
        details.AppendLine().Append(label).Append(".message=").Append(error.Message);
        details.AppendLine().Append(label).Append(".hresult=0x")
            .Append(unchecked((uint)error.HResult).ToString("X8", CultureInfo.InvariantCulture));
        details.AppendLine().Append(label).Append(".source=")
            .Append(error.Source ?? "<none>");
        details.AppendLine().Append(label).Append(".stack=")
            .Append(error.StackTrace ?? "<none>");

        var dataIndex = 0;
        foreach (DictionaryEntry entry in error.Data)
        {
            details.AppendLine().Append(label).Append(".data[")
                .Append(dataIndex.ToString(CultureInfo.InvariantCulture)).Append("].key=")
                .Append(DescribeDataValue(entry.Key));
            details.AppendLine().Append(label).Append(".data[")
                .Append(dataIndex.ToString(CultureInfo.InvariantCulture)).Append("].value=")
                .Append(DescribeDataValue(entry.Value));
            dataIndex++;
        }

        if (error.InnerException is not null)
            AppendException(details, error.InnerException, $"{label}.inner", depth + 1, visited);
        if (error is AggregateException aggregate)
        {
            for (var index = 0; index < aggregate.InnerExceptions.Count; index++)
            {
                var inner = aggregate.InnerExceptions[index];
                if (!ReferenceEquals(inner, error.InnerException))
                    AppendException(details, inner, $"{label}.aggregate[{index}]", depth + 1, visited);
            }
        }
    }

    private static string DescribeDataValue(object? value) => value switch
    {
        null => "<null>",
        string text => text,
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture) ??
            $"<{value.GetType().FullName}>",
        _ => $"<{value.GetType().FullName}>",
    };

    private static string Redact(string value)
    {
        var redacted = SecretLike().Replace(
            Email().Replace(
                Bearer().Replace(value ?? string.Empty, "Bearer [redacted]"),
                "[redacted-email]"),
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

    [GeneratedRegex("(?i)\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b")]
    private static partial Regex Email();

    [GeneratedRegex("(?i)\\b(?:sk-[A-Za-z0-9_-]{8,}|(?:access|refresh|auth)[_-]?token\\s*[:=]\\s*[^,}\\s]+)")]
    private static partial Regex SecretLike();
}

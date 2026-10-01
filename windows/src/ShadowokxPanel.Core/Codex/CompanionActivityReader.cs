using System.Globalization;
using System.Text;
using System.Text.Json;

namespace ShadowokxPanel.Core.Codex;

// Local session events only: no model requests or account polling.
public sealed class CompanionActivityReader(string? codexHome = null)
{
    private readonly Dictionary<string, (DateTime Modified, bool Active, bool Completed)> _files = [];

    public async Task<(bool Active, bool Completed)> ReadAsync()
    {
        var home = codexHome ?? Environment.GetEnvironmentVariable("CODEX_HOME");
        if (string.IsNullOrWhiteSpace(home))
            home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
        var now = DateTimeOffset.UtcNow;
        var dates = new[] { now, now.AddDays(-1), now.ToLocalTime(), now.ToLocalTime().AddDays(-1) };
        var paths = new List<string>();
        foreach (var date in dates.Select(date => date.ToString("yyyy/MM/dd", CultureInfo.InvariantCulture)).Distinct())
        {
            var directory = Path.Combine(home, "sessions", date.Replace('/', Path.DirectorySeparatorChar));
            try
            {
                if (Directory.Exists(directory))
                    paths.AddRange(Directory.EnumerateFiles(directory, "*.jsonl"));
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        }
        var completed = false;
        foreach (var path in paths.Distinct())
        {
            try
            {
                var modified = File.GetLastWriteTimeUtc(path);
                var known = _files.TryGetValue(path, out var previous);
                if (known && previous.Modified == modified) continue;
                if (!known && modified < now.UtcDateTime.AddMinutes(-2)) continue;
                using var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
                    FileShare.ReadWrite | FileShare.Delete, 4096, FileOptions.Asynchronous);
                var start = Math.Max(0, stream.Length - 131072);
                stream.Seek(start, SeekOrigin.Begin);
                var bytes = new byte[stream.Length - start];
                await stream.ReadExactlyAsync(bytes).ConfigureAwait(false);
                var text = Encoding.UTF8.GetString(bytes);
                if (start > 0) text = text[(text.IndexOf('\n') + 1)..];
                var active = known && previous.Active;

                var success = false;
                // Ignore a partial last record while Codex is appending it.
                foreach (var line in text.Split('\n').SkipLast(1))
                {
                    try
                    {
                        using var record = JsonDocument.Parse(line);
                        var root = record.RootElement;
                        if (!root.TryGetProperty("type", out var recordType) ||
                            !root.TryGetProperty("payload", out var payload)) continue;
                        if (recordType.GetString() == "event_msg" && payload.TryGetProperty("type", out var type))
                        {
                            if (type.GetString() == "task_started") { active = true; success = false; }
                            else if (type.GetString() is "task_complete" or "turn_aborted")
                            { active = false; success = type.GetString() == "task_complete"; }
                        }
                        else if (recordType.GetString() == "response_item" &&
                            payload.TryGetProperty("type", out var messageType) && messageType.GetString() == "message" &&
                            payload.TryGetProperty("role",out var role) && role.GetString() == "assistant" &&
                            payload.TryGetProperty("phase",out var phase) && phase.GetString() == "final_answer")
                        { active=false;  success=true; }
                        else if (recordType.GetString() == "response_item" &&
                            payload.TryGetProperty("type", out var item) &&
                            item.GetString() is "reasoning" or "function_call" or "custom_tool_call")
                            { active = true; }
                    }
                    catch (JsonException) { }
                }
                completed |= known && previous.Active && !active && success;
                _files[path] = (modified, active, success);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            { _files.Remove(path); }
        }
        foreach (var path in _files.Keys.Where(path => !paths.Contains(path)).ToArray())
            _files.Remove(path);
        return (_files.Values.Any(file => file.Active), completed);
    }
}

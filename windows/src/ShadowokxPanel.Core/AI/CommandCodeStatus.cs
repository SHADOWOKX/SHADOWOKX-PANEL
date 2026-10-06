using System.Diagnostics;
using System.Text.Json;
namespace ShadowokxPanel.Core.AI;

// Documentation reference only; never used as an AIUsage or provider state.
public sealed record CommandCodePlanReference(string Title, string Price, string Limits,
    string Note, string Checked, Uri Source);
public static class CommandCodeReference
{
    public static Uri UsageUri { get; } = new("https://commandcode.ai/usage");
    public static CommandCodePlanReference Goat { get; } = new(
        "GOAT · documented plan limits",
        "$10/month · published plan, not your detected subscription",
        "70 credits per billing cycle · 14 per 5 hours · 35 per 7 days",
        "Usage-value credits; model allowances vary. Top-ups are separate. Usage windows reset from first use. These are not your balance or consumption.",
        "Documentation checked 3 Oct 2026",
        new("https://commandcode.ai/docs/resources/usage-limits"));
}

public static class CommandCodeStatus
{
    public static TimeSpan Interval => TimeSpan.FromMinutes(5);
    public const string Limitation = "The API key connection is separate from the CLI login. Published plan limits remain documentation reference only; live account metrics come from the read-only API.";
    public static string Parse(string output)
    {
        try
        {
            using var doc = JsonDocument.Parse(output);
            var raw = doc.RootElement;
            if (raw.ValueKind != JsonValueKind.Object || !raw.TryGetProperty("authenticated", out var auth) ||
                auth.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return "unsupported";
            if (raw.TryGetProperty("error", out var error) && error.ValueKind is not (JsonValueKind.Null or JsonValueKind.False) &&
                !(error.ValueKind == JsonValueKind.String && error.GetString() == "")) return "error";
            return auth.GetBoolean() ? "authenticated" : "signed-out";
        }
        catch (JsonException) { return "unsupported"; }
    }
    public static string Message(string status) => (status switch
    {
        "authenticated" => "Command Code login detected. ",
        "signed-out" => "Sign in with cmdc login on Windows or cmd login on Linux. ",
        "missing" => "Install the Command Code CLI and sign in with cmdc login. ",
        "unsupported" => "Update the Command Code CLI to support status --json. ",
        _ => "Could not verify Command Code login. Retry or sign in again. ",
    }) + Limitation;

    // npm's Windows .cmd shim is resolved to its JS entry point, never passed to a shell.
    public static (string Binary, string? Script)? Discover(string? path = null, bool? windows = null) =>
        Discover(path, windows ?? OperatingSystem.IsWindows(), File.Exists, Path.IsPathFullyQualified,
            static (directory, name) => Path.Combine(directory, name));

    // Dependency-injected core: the platform flag, filesystem and path semantics are
    // parameters, so discovery is deterministic and never depends on the host OS.
    internal static (string Binary, string? Script)? Discover(string? path, bool windows,
        Func<string, bool> fileExists, Func<string, bool> isFullyQualified, Func<string, string, string> combine)
    {
        var value = path ?? Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        var directories = value.Split(windows ? ';' : ':');
        var names = windows ? new[] { "cmdc.exe", "commandcode.exe" } : new[] { "cmdc", "commandcode", "cmd" };
        foreach (var directory in directories.Where(isFullyQualified))
        {
            foreach (var name in names)
            {
                var binary = combine(directory, name);
                if (fileExists(binary)) return (binary, null);
            }
            if (!windows) continue;
            var script = combine(combine(combine(combine(directory, "node_modules"), "command-code"), "dist"),
                "index.mjs");
            if (!fileExists(script)) continue;
            var node = directories.Where(isFullyQualified).Select(d => combine(d, "node.exe"))
                .FirstOrDefault(fileExists);
            if (node is not null) return (node, script);
        }
        return null;
    }
    public static async Task<string> ReadAsync(string? binary = null, string? script = null,
        TimeSpan? timeout = null, CancellationToken cancellation = default)
    {
        var found = binary is null ? Discover() : (binary, script);
        if (found is null) return "missing";
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(timeout ?? TimeSpan.FromSeconds(15));
        using var process = new Process();
        try
        {
            var start = new ProcessStartInfo(found.Value.Item1) { UseShellExecute = false,
                RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true, CreateNoWindow = true };
            if (found.Value.Item2 is { } entry) start.ArgumentList.Add(entry);
            start.ArgumentList.Add("status"); start.ArgumentList.Add("--json");
            process.StartInfo = start;
            process.Start(); process.StandardInput.Close();
            using var stop = deadline.Token.Register(() => { try { if (!process.HasExited) process.Kill(true); } catch (InvalidOperationException) { } });
            // Drain and discard stderr with fixed memory; it may contain secrets.
            async Task DiscardErrors()
            {
                var buffer = new char[1024];
                try { while (await process.StandardError.ReadAsync(buffer, deadline.Token).ConfigureAwait(false) > 0) { } }
                catch (Exception error) when (error is IOException or OperationCanceledException) { }
            }
            var errors = DiscardErrors();
            var output = new System.Text.StringBuilder(); var chunk = new char[4096]; int read;
            while ((read = await process.StandardOutput.ReadAsync(chunk, deadline.Token).ConfigureAwait(false)) > 0)
            {
                if (output.Length + read > 16384) { deadline.Cancel(); break; }
                output.Append(chunk, 0, read);
            }
            await process.WaitForExitAsync(deadline.Token).ConfigureAwait(false);
            await errors.ConfigureAwait(false);
            if (deadline.IsCancellationRequested) return "error";
            return Parse(output.ToString());
        }
        catch (Exception error) when (error is IOException or InvalidOperationException or System.ComponentModel.Win32Exception or OperationCanceledException)
        { return "error"; }
        finally { try { if (!process.HasExited) process.Kill(true); } catch (InvalidOperationException) { } }
    }
}

using System.Diagnostics;
using System.Text.Json;
using ShadowokxPanel.Core.Models;

namespace ShadowokxPanel.Core.Codex;

public interface ICodexProtocolClient
{
    Task<CodexProtocolResponse> ReadAsync(
        CodexLaunchSpec launch,
        CancellationToken cancellationToken = default);
}

public sealed class CodexProtocolClient : ICodexProtocolClient
{
    private const int MaximumLineCharacters = 1_048_576;
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(15);

    public async Task<CodexProtocolResponse> ReadAsync(
        CodexLaunchSpec launch,
        CancellationToken cancellationToken = default)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Timeout);
        using var process = new Process { StartInfo = CreateStartInfo(launch) };
        if (!process.Start())
            throw new InvalidOperationException("Codex could not be started.");
        var stderrDrain = process.StandardError.ReadToEndAsync(timeout.Token);
        JsonElement? rateLimits = null;
        JsonElement? usage = null;
        var usageSettled = false;
        try
        {
            await WriteAsync(process, new
            {
                jsonrpc = "2.0",
                id = 1,
                method = "initialize",
                @params = new
                {
                    clientInfo = new
                    {
                        name = "shadowokx-panel",
                        title = "Shadowokx Panel",
                        version = "1.0.0",
                    },
                    capabilities = new
                    {
                        experimentalApi = false,
                        requestAttestation = false,
                    },
                },
            }, timeout.Token).ConfigureAwait(false);

            var initialized = false;
            for (var i = 0; i < 512 && !initialized; i++)
            {
                using var message = await ReadMessageAsync(process, timeout.Token).ConfigureAwait(false);
                if (ReadId(message.RootElement) != 1)
                    continue;
                if (message.RootElement.TryGetProperty("error", out _) ||
                    !message.RootElement.TryGetProperty("result", out _))
                    throw new InvalidDataException("Codex rejected initialization.");
                initialized = true;
            }
            if (!initialized)
                throw new InvalidDataException("Codex did not initialize.");

            await WriteAsync(process, new { jsonrpc = "2.0", method = "initialized" }, timeout.Token)
                .ConfigureAwait(false);
            await WriteAsync(process, new
            {
                jsonrpc = "2.0", id = 2, method = "account/usage/read", @params = new { },
            }, timeout.Token).ConfigureAwait(false);
            await WriteAsync(process, new
            {
                jsonrpc = "2.0", id = 3, method = "account/rateLimits/read",
            }, timeout.Token).ConfigureAwait(false);

            for (var i = 0; i < 512; i++)
            {
                using var message = await ReadMessageAsync(process, timeout.Token).ConfigureAwait(false);
                var id = ReadId(message.RootElement);
                if (id == 2)
                {
                    usageSettled = true;
                    if (!message.RootElement.TryGetProperty("error", out _) &&
                        message.RootElement.TryGetProperty("result", out var result))
                        usage = result.Clone();
                }
                else if (id == 3)
                {
                    if (message.RootElement.TryGetProperty("error", out _))
                        throw new InvalidDataException("Codex usage is unavailable.");
                    if (!message.RootElement.TryGetProperty("result", out var result))
                        throw new InvalidDataException("Codex returned an invalid limit response.");
                    rateLimits = result.Clone();
                }
                if (rateLimits.HasValue && usageSettled)
                    return new CodexProtocolResponse(rateLimits.Value, usage);
            }
            throw new InvalidDataException("Codex returned too many unrelated messages.");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested && rateLimits.HasValue)
        {
            return new CodexProtocolResponse(rateLimits.Value, null);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new TimeoutException("Codex did not respond in time.");
        }
        finally
        {
            try
            {
                if (!process.HasExited)
                    process.Kill(true);
            }
            catch (InvalidOperationException) { }
            try { await stderrDrain.ConfigureAwait(false); }
            catch (Exception error) when (error is InvalidOperationException or OperationCanceledException) { }
        }
    }

    private static ProcessStartInfo CreateStartInfo(CodexLaunchSpec launch)
    {
        var info = new ProcessStartInfo
        {
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        if (launch.IsCommandShim)
        {
            info.FileName = Path.Combine(Environment.SystemDirectory, "cmd.exe");
            info.ArgumentList.Add("/d");
            info.ArgumentList.Add("/s");
            info.ArgumentList.Add("/c");
            info.ArgumentList.Add($"\"\"{launch.ExecutablePath}\" app-server --stdio\"");
        }
        else
        {
            info.FileName = launch.ExecutablePath;
            info.ArgumentList.Add("app-server");
            info.ArgumentList.Add("--stdio");
        }
        return info;
    }

    private static async Task WriteAsync(
        Process process,
        object message,
        CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(message);
        await process.StandardInput.WriteLineAsync(json.AsMemory(), cancellationToken)
            .ConfigureAwait(false);
        await process.StandardInput.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task<JsonDocument> ReadMessageAsync(
        Process process,
        CancellationToken cancellationToken)
    {
        for (var i = 0; i < 512; i++)
        {
            var line = await process.StandardOutput.ReadLineAsync(cancellationToken).ConfigureAwait(false);
            if (line is null)
                throw new InvalidDataException("Codex closed the protocol stream.");
            if (line.Length > MaximumLineCharacters)
                throw new InvalidDataException("Codex response exceeded the safe size limit.");
            try { return JsonDocument.Parse(line); }
            catch (JsonException) { }
        }
        throw new InvalidDataException("Codex returned too many non-JSON lines.");
    }

    private static int? ReadId(JsonElement root) =>
        root.TryGetProperty("id", out var id) && id.TryGetInt32(out var number) ? number : null;
}

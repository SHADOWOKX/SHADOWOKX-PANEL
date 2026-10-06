using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ShadowokxPanel.Core.AI;

public sealed record CommandCodeRouteResponse(int Status, string? RetryAfter, byte[]? Body);
public delegate Task<CommandCodeRouteResponse> CommandCodeTransport(string path, string key,
    CancellationToken cancellationToken);

// Fixed origin and route allowlist. Redirects are disabled so credentials cannot
// follow a redirect to another host. Only read-only account requests are issued.
public sealed class CommandCodeApi : IDisposable
{
    public const int IntervalSeconds = 180;
    private const string BaseAddress = "https://api.commandcode.ai";
    private static readonly string[] Routes =
        ["/alpha/whoami", "/alpha/billing/credits", "/alpha/billing/subscriptions", "/alpha/usage/summary"];
    private static readonly TimeSpan IdentityTtl = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan OptionalCooldown = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(15);

    private readonly CommandCodeTransport _transport;
    private readonly Func<DateTimeOffset> _clock;
    private readonly HttpClient? _http;
    private readonly Dictionary<string, DateTimeOffset> _optionalUnavailable = [];
    private CommandCodeAccount? _identity;
    private DateTimeOffset _identityCheckedAt;
    private string? _keyDigest;
    private string? _inFlightDigest;
    private Task<CommandCodeUsage>? _inFlight;
    private DateTimeOffset? _retryAt;
    private bool _disposed;

    public CommandCodeApi(HttpClient? http = null, CommandCodeTransport? transport = null,
        Func<DateTimeOffset>? clock = null)
    {
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        if (transport is not null)
        {
            _transport = transport;
        }
        else
        {
            _http = http ?? new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
            { Timeout = Timeout.InfiniteTimeSpan };
            _transport = SendHttpAsync;
        }
    }

    public DateTimeOffset? RetryAt => _retryAt;

    private async Task<CommandCodeRouteResponse> SendHttpAsync(string path, string key,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, BaseAddress + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.TryAddWithoutValidation("User-Agent", "commandcode-usage/1.0");
        using var response = await _http!.SendAsync(request, HttpCompletionOption.ResponseHeadersRead,
            cancellationToken).ConfigureAwait(false);
        var retry = response.Headers.RetryAfter?.ToString();
        byte[]? body = null;
        if (response.StatusCode == HttpStatusCode.OK)
        {
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            using var memory = new MemoryStream();
            var buffer = new byte[8192];
            int read;
            while ((read = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false)) > 0)
            {
                if (memory.Length + read > 1024 * 1024)
                    throw new CommandCodeException("api-changed");
                memory.Write(buffer, 0, read);
            }
            body = memory.ToArray();
        }
        return new((int)response.StatusCode, retry, body);
    }

    public Task<CommandCodeUsage> FetchAsync(string key, CancellationToken cancellationToken = default)
    {
        if (_disposed)
            return Task.FromException<CommandCodeUsage>(new CommandCodeException("cancelled"));
        CommandCodeUsage.ValidateKey(key);
        var digest = Digest(key);
        if (_inFlight is not null)
            return digest == _inFlightDigest
                ? _inFlight
                : Task.FromException<CommandCodeUsage>(new CommandCodeException("cancelled"));
        _inFlightDigest = digest;
        var current = FetchCoreAsync(key, cancellationToken);
        _inFlight = current;
        _ = current.ContinueWith(_ => { if (ReferenceEquals(_inFlight, current)) _inFlight = null; },
            CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        return current;
    }

    private async Task<CommandCodeUsage> FetchCoreAsync(string key, CancellationToken cancellationToken)
    {
        CommandCodeUsage.ValidateKey(key);
        var now = _clock();
        var digest = Digest(key);
        if (digest != _keyDigest)
        {
            _keyDigest = digest;
            _identity = null;
            _optionalUnavailable.Clear();
            _retryAt = null;
        }
        if (_retryAt is { } retry && retry > now)
            throw new CommandCodeException("rate-limited", retry);
        try
        {
            if (_identity is null || now - _identityCheckedAt >= IdentityTtl)
            {
                var raw = await GetAsync(Routes[0], key, cancellationToken).ConfigureAwait(false);
                _identity = CommandCodeUsage.ReadIdentity(raw);
                _identityCheckedAt = now;
            }
            var credits = await GetAsync(Routes[1], key, cancellationToken).ConfigureAwait(false);
            // Missing or changed mandatory data must not trigger optional requests.
            _ = CommandCodeUsage.Parse(_identity, credits, null, null, now);
            var warnings = new List<string>();

            async Task<JsonElement?> OptionalAsync(string route)
            {
                var name = route.Split('?', 2)[0];
                if (_optionalUnavailable.TryGetValue(name, out var until) && until > now)
                {
                    warnings.Add("api-changed");
                    return null;
                }
                try
                {
                    var raw = await GetAsync(route, key, cancellationToken).ConfigureAwait(false);
                    var isSubscription = route.StartsWith(Routes[2], StringComparison.Ordinal);
                    var data = CommandCodeJson.Get(raw, "data");
                    var body = isSubscription
                        ? CommandCodeJson.IsRecord(data) ? data : CommandCodeJson.Get(raw, "subscription")
                        : CommandCodeJson.IsRecord(data) ? data : raw;
                    var valid = CommandCodeJson.IsRecord(body) &&
                        (isSubscription
                            ? body.TryGetProperty("planId", out _) || body.TryGetProperty("plan_id", out _)
                            : CommandCodeJson.Amount(CommandCodeJson.Get(body, "totalCount")) is not null ||
                                CommandCodeJson.Amount(CommandCodeJson.Get(body, "totalCredits")) is not null);
                    if (!valid || CommandCodeJson.Get(raw, "success").ValueKind == JsonValueKind.False)
                        throw new CommandCodeException("api-changed");
                    return raw;
                }
                catch (CommandCodeException error) when
                    (error.Code is not "authentication-failed" and not "cancelled")
                {
                    if (error.HttpStatus == 404)
                        _optionalUnavailable[name] = now + OptionalCooldown;
                    warnings.Add(error.Code);
                    return null;
                }
            }

            var reportedOrg = _identity.OrgId;
            var orgId = !string.IsNullOrEmpty(reportedOrg) && !reportedOrg.Contains(key, StringComparison.Ordinal)
                ? reportedOrg : null;
            var subscription = await OptionalAsync(Routes[2] +
                (orgId is null ? string.Empty : "?orgId=" + Uri.EscapeDataString(orgId))).ConfigureAwait(false);
            var summary = _retryAt is { } limited && limited > now
                ? null
                : await OptionalAsync(Routes[3]).ConfigureAwait(false);
            var data = CommandCodeUsage.Parse(_identity, credits, subscription, summary, _clock());
            data = data with { Warnings = warnings.Distinct(StringComparer.Ordinal).ToArray(), RetryAt = _retryAt };
            // A server must not reflect the supplied key into display fields.
            data = data with
            {
                Account = Scrub(data.Account, key),
                Plan = Scrub(data.Plan, key),
                PlanId = Scrub(data.PlanId, key),
                PlanStatus = Scrub(data.PlanStatus, key),
                Consumption = data.Consumption with
                {
                    PeriodBasis = Scrub(data.Consumption.PeriodBasis, key),
                },
            };
            return data;
        }
        catch (CommandCodeException error) when (error.Code == "authentication-failed")
        {
            _identity = null;
            throw;
        }
    }

    private async Task<JsonElement> GetAsync(string path, string key, CancellationToken cancellationToken)
    {
        if (_disposed || cancellationToken.IsCancellationRequested)
            throw new CommandCodeException("cancelled");
        if (Array.IndexOf(Routes, path.Split('?', 2)[0]) < 0)
            throw new CommandCodeException("api-changed");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(RequestTimeout);
        CommandCodeRouteResponse response;
        try
        {
            response = await _transport(path, key, deadline.Token).ConfigureAwait(false);
        }
        catch (CommandCodeException)
        {
            throw;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw new CommandCodeException("cancelled");
        }
        catch (OperationCanceledException)
        {
            throw new CommandCodeException("timeout");
        }
        catch (Exception error) when (error is HttpRequestException or IOException)
        {
            throw new CommandCodeException(_disposed || cancellationToken.IsCancellationRequested
                ? "cancelled" : "network");
        }
        if (deadline.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
            throw new CommandCodeException("timeout");
        if (response.Status is 401 or 403)
            throw new CommandCodeException("authentication-failed");
        if (response.Status == 429)
        {
            var retry = CommandCodeUsage.RetryAfter(response.RetryAfter, _clock());
            _retryAt = _retryAt is { } previous && previous > retry ? previous : retry;
            throw new CommandCodeException("rate-limited", _retryAt);
        }
        if (response.Status != 200)
        {
            var error = new CommandCodeException(response.Status >= 500 ? "server" : "api-changed")
            { HttpStatus = response.Status };
            throw error;
        }
        var raw = CommandCodeUsage.DecodeResponse(response.Body);
        if (raw.ValueKind != JsonValueKind.Object)
            throw new CommandCodeException("api-changed");
        return raw;
    }

    private static string? Scrub(string? value, string key) =>
        value is not null && value.Contains(key, StringComparison.Ordinal) ? null : value;

    private static string Digest(string key) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)));

    public void Dispose()
    {
        _disposed = true;
        _http?.Dispose();
        _identity = null;
        _keyDigest = null;
    }
}

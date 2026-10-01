using System.Net.Http.Headers;
using System.Text.Json;
using ShadowokxPanel.Core.Settings;
using ShadowokxPanel.Core.Storage;
namespace ShadowokxPanel.Core.AI;

public sealed record AIState(AIUsage? Usage = null, string? Error = null)
{
    public bool Stale => Error is not null || Usage is { } usage && DateTimeOffset.UtcNow - usage.UpdatedAt > TimeSpan.FromMinutes(5);
}
public sealed class AIProviderService : IDisposable
{
    private readonly ApplicationPaths _paths;
    private readonly SettingsStore _settings;
    private readonly HttpClient _http = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(15) };
    private readonly SemaphoreSlim _refresh = new(1,1);
    private readonly CancellationTokenSource _stop = new();
    private readonly Dictionary<string,AIState> _states = [];
    private readonly List<FileSystemWatcher> _watchers = [];
    private bool _disposed;
    public AIProviderService(ApplicationPaths paths, SettingsStore settings) { _paths=paths; _settings=settings; }
    public event EventHandler? Changed;
    public string DefaultPath(string id) => System.IO.Path.Combine(_paths.Root,"usage",id+".json");
    public AIState State(string id) { lock (_states) return _states.GetValueOrDefault(id) ?? new(); }
    public void Start()
    {
        _settings.Changed += SettingsChanged;
        Watch(); _ = PollAsync();
    }
    private void SettingsChanged(object? sender, AppSettings settings) { Watch(); _ = RefreshAsync(); }
    private void Watch()
    {
        foreach (var watcher in _watchers) watcher.Dispose(); _watchers.Clear();
        Directory.CreateDirectory(System.IO.Path.Combine(_paths.Root,"usage"));
        foreach (var id in AICatalog.Providers.Keys.Where(id=>id!="codex"))
        {
            var path = _settings.Current.AISources.GetValueOrDefault(id)?.Path;
            if (string.IsNullOrWhiteSpace(path)) path = DefaultPath(id);
            var parent = System.IO.Path.GetDirectoryName(path);
            if (parent is null || !Directory.Exists(parent)) continue;
            try
            {
                var watcher = new FileSystemWatcher(parent,System.IO.Path.GetFileName(path)) { NotifyFilter=NotifyFilters.LastWrite|NotifyFilters.FileName|NotifyFilters.Size };
                watcher.Changed += FileChanged; watcher.Created += FileChanged; watcher.Deleted += FileChanged; watcher.Renamed += FileChanged;
                watcher.EnableRaisingEvents=true; _watchers.Add(watcher);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException) { }
        }
    }
    private void FileChanged(object sender, FileSystemEventArgs args) => _ = RefreshAsync();
    private async Task PollAsync()
    {
        try { while (!_stop.IsCancellationRequested) { await RefreshAsync(); await Task.Delay(TimeSpan.FromSeconds(30),_stop.Token).ConfigureAwait(false); } }
        catch (OperationCanceledException) { }
    }
    public async Task RefreshAsync()
    {
        if (_disposed) return;
        try
        {
            await _refresh.WaitAsync(_stop.Token).ConfigureAwait(false);
            try
            {
                foreach (var id in _settings.Current.VisibleProviders.Where(id=>id!="codex" && !_settings.Current.RemovedProviders.Contains(id)))
                {
                    if (_stop.IsCancellationRequested) return;
                    var source = _settings.Current.AISources.GetValueOrDefault(id) ?? new();
                    try
                    {
                        string json;
                        if (id=="deepseek" && source.Path.Length==0 && source.KeyFile.Length>0)
                        {
                            var info = new FileInfo(source.KeyFile);
                            if (info.Length>4096 || info.LinkTarget is not null) throw new IOException("Choose a regular key file smaller than 4 KB.");
                            var key=(await File.ReadAllTextAsync(source.KeyFile,_stop.Token).ConfigureAwait(false)).Trim();
                            if (key.Length==0 || key.Any(char.IsWhiteSpace)) throw new IOException("API key file must contain only the key.");
                            using var request = new HttpRequestMessage(HttpMethod.Get,"https://api.deepseek.com/user/balance");
                            request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",key);
                            using var response=await _http.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,_stop.Token).ConfigureAwait(false);
                            if (!response.IsSuccessStatusCode) throw new IOException($"DeepSeek returned HTTP {(int)response.StatusCode}.");
                            await using var stream=await response.Content.ReadAsStreamAsync(_stop.Token).ConfigureAwait(false);
                            using var memory=new MemoryStream(); var buffer=new byte[8192]; int read;
                            while ((read=await stream.ReadAsync(buffer,_stop.Token).ConfigureAwait(false))>0) { if (memory.Length+read>1048576) throw new IOException("Usage response is too large."); memory.Write(buffer,0,read); }
                            json=System.Text.Encoding.UTF8.GetString(memory.ToArray());
                        }
                        else
                        {
                            var path=source.Path.Length>0?source.Path:DefaultPath(id);
                            if (!System.IO.Path.IsPathFullyQualified(path)) throw new IOException("Choose an absolute usage file path.");
                            var info=new FileInfo(path); if (info.Length>1048576) throw new IOException("Usage file is too large.");
                            await using var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete);
                            using var reader=new StreamReader(stream); json=await reader.ReadToEndAsync(_stop.Token).ConfigureAwait(false);
                        }
                        using var doc=JsonDocument.Parse(json);
                        var usage=AIUsageNormalizer.Normalize(doc.RootElement,id,DateTimeOffset.UtcNow);
                        lock (_states) _states[id]=new(usage);
                    }
                    catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or HttpRequestException or ArgumentException or OperationCanceledException)
                    {
                        if (_stop.IsCancellationRequested) return;
                        lock (_states) _states[id]=new(_states.GetValueOrDefault(id)?.Usage,"Connect a usage source in Settings, or check your connection.");
                    }
                }
                Changed?.Invoke(this,EventArgs.Empty);
            }
            finally { _refresh.Release(); }
        }
        catch (OperationCanceledException) { }
    }
    public bool AnyWorking() => _settings.Current.VisibleProviders.Where(id=>id!="codex" && !_settings.Current.RemovedProviders.Contains(id))
        .Any(id=>State(id).Usage?.IsWorking(DateTimeOffset.UtcNow)==true);
    public void Dispose()
    {
        if (_disposed) return; _disposed=true;
        _settings.Changed-=SettingsChanged; _stop.Cancel();
        foreach (var watcher in _watchers) watcher.Dispose(); _watchers.Clear();
        _http.Dispose(); GC.SuppressFinalize(this);
    }
}

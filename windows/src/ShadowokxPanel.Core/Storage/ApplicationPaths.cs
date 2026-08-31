namespace ShadowokxPanel.Core.Storage;

public sealed class ApplicationPaths
{
    public ApplicationPaths(string? localApplicationData = null)
    {
        var root = localApplicationData ??
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(root))
            throw new InvalidOperationException("Local application data is unavailable.");

        Root = Path.Combine(Path.GetFullPath(root), "ShadowokxPanel");
        Cache = Path.Combine(Root, "cache");
        Data = Path.Combine(Root, "data");
        Logs = Path.Combine(Root, "logs");
        SettingsFile = Path.Combine(Root, "settings.json");
        CodexCacheFile = Path.Combine(Cache, "codex.json");
        WeatherCacheFile = Path.Combine(Cache, "weather.json");
        HistoryFile = Path.Combine(Data, "codex-history.json");
    }

    public string Root { get; }
    public string Cache { get; }
    public string Data { get; }
    public string Logs { get; }
    public string SettingsFile { get; }
    public string CodexCacheFile { get; }
    public string WeatherCacheFile { get; }
    public string HistoryFile { get; }
}

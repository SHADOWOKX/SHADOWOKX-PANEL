using ShadowokxPanel.Core.Storage;

namespace ShadowokxPanel.Core.Settings;

public sealed class SettingsStore
{
    private const int CurrentSettingsSchemaVersion = 1;
    private readonly JsonFileStore<AppSettings> _store;

    public SettingsStore(ApplicationPaths paths)
    {
        _store = new JsonFileStore<AppSettings>(paths.SettingsFile);
    }

    public AppSettings Current { get; private set; } = new();
    public event EventHandler<AppSettings>? Changed;

    public async Task<AppSettings> LoadAsync(CancellationToken cancellationToken = default)
    {
        Current = Validate(await _store.ReadAsync(cancellationToken).ConfigureAwait(false));
        return Current;
    }

    public async Task SaveAsync(AppSettings settings, CancellationToken cancellationToken = default)
    {
        Current = Validate(settings);
        await _store.WriteAsync(Current, cancellationToken).ConfigureAwait(false);
        Changed?.Invoke(this, Current);
    }

    public Task ResetAsync(CancellationToken cancellationToken = default) =>
        SaveAsync(new AppSettings(), cancellationToken);

    public static AppSettings Validate(AppSettings? value)
    {
        var settings = value ?? new AppSettings();
        var accent = settings.CustomAccent?.Trim() ?? string.Empty;
        if (!System.Text.RegularExpressions.Regex.IsMatch(accent, "^#[0-9a-fA-F]{6}$"))
            accent = "#f97316";
        var accentPreset = Enum.IsDefined(settings.Accent)
            ? settings.Accent : AccentPreset.Orange;
        // Rose was the pre-release default. Migrate that default once while preserving
        // an explicit Rose choice made after this schema revision.
        if (settings.SettingsSchemaVersion < CurrentSettingsSchemaVersion &&
            accentPreset == AccentPreset.Rose)
            accentPreset = AccentPreset.Orange;
        return settings with
        {
            SettingsSchemaVersion = CurrentSettingsSchemaVersion,
            Theme = Enum.IsDefined(settings.Theme) ? settings.Theme : ThemePreset.System,
            Accent = accentPreset,
            Density = Enum.IsDefined(settings.Density) ? settings.Density : LayoutDensity.Comfortable,
            CustomAccent = accent.ToLowerInvariant(),
            WeatherLocation = NormalizeLocation(settings.WeatherLocation),
            TemperatureUnit = settings.TemperatureUnit == "fahrenheit" ? "fahrenheit" : "celsius",
            WindUnit = settings.WindUnit == "mph" ? "mph" : "kmh",
            CodexRefreshMinutes = Math.Clamp(settings.CodexRefreshMinutes, 5, 120),
            WeatherRefreshMinutes = Math.Clamp(settings.WeatherRefreshMinutes, 15, 180),
            LastPage = settings.LastPage == "weather" ? "weather" : "codex",
        };
    }

    private static string NormalizeLocation(string? value)
    {
        var cleaned = string.Join(' ', (value ?? string.Empty)
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (string.IsNullOrWhiteSpace(cleaned))
            return "Cairo, Egypt";
        return cleaned.Length <= 120 ? cleaned : cleaned[..120];
    }
}

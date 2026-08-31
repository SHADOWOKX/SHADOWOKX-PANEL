namespace ShadowokxPanel.Core.Settings;

public enum ThemePreset
{
    System,
    Shadow,
    Midnight,
    Graphite,
    Nord,
    Amoled,
    Light,
}

public enum AccentPreset
{
    Rose,
    Orange,
    Emerald,
    Cyan,
    Blue,
    Violet,
    Amber,
    Monochrome,
    Custom,
}

public enum LayoutDensity
{
    Compact,
    Comfortable,
}

public sealed record AppSettings
{
    public bool StartWithWindows { get; init; }
    public bool ShowWeather { get; init; } = true;
    public bool ShowCodexStateIndicator { get; init; }
    public bool ShowWeatherInTrayTooltip { get; init; } = true;
    public bool ChangeTrayIconWithUsageState { get; init; } = true;
    public bool RefreshOnOpen { get; init; } = true;
    public bool RememberLastPage { get; init; } = true;
    public string LastPage { get; init; } = "codex";
    public ThemePreset Theme { get; init; } = ThemePreset.System;
    public AccentPreset Accent { get; init; } = AccentPreset.Rose;
    public string CustomAccent { get; init; } = "#f43f5e";
    public LayoutDensity Density { get; init; } = LayoutDensity.Comfortable;
    public bool Animations { get; init; } = true;
    public bool ShowLifetimeTokens { get; init; } = true;
    public bool ShowTokenHistory { get; init; } = true;
    public bool ShowUsageState { get; init; } = true;
    public string WeatherLocation { get; init; } = "Cairo, Egypt";
    public string TemperatureUnit { get; init; } = "celsius";
    public string WindUnit { get; init; } = "kmh";
    public bool ShowUv { get; init; } = true;
    public bool ShowHourlyPrecipitation { get; init; } = true;
    public int CodexRefreshMinutes { get; init; } = 15;
    public int WeatherRefreshMinutes { get; init; } = 30;
    public bool DebugLogging { get; init; }
}

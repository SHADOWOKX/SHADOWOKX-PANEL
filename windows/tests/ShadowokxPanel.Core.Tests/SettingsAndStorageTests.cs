using ShadowokxPanel.Core.Settings;
using ShadowokxPanel.Core.Storage;

namespace ShadowokxPanel.Core.Tests;

public sealed class SettingsAndStorageTests
{
    [Fact]
    public async Task SettingsPersistInPerUserRoot()
    {
        using var temporary = TemporaryDirectory.Create();
        var store = new SettingsStore(temporary.Paths);
        await store.SaveAsync(new AppSettings
        {
            Theme = ThemePreset.Nord,
            Accent = AccentPreset.Cyan,
            WeatherLocation = "  New   York, US  ",
        });
        var reloaded = new SettingsStore(temporary.Paths);
        var value = await reloaded.LoadAsync();
        Assert.Equal(ThemePreset.Nord, value.Theme);
        Assert.Equal(AccentPreset.Cyan, value.Accent);
        Assert.Equal("New York, US", value.WeatherLocation);
        Assert.StartsWith(temporary.Root, temporary.Paths.SettingsFile, StringComparison.Ordinal);
    }

    [Fact]
    public void InvalidSettingsFailSafe()
    {
        var value = SettingsStore.Validate(new AppSettings
        {
            CustomAccent = "javascript:red",
            CodexRefreshMinutes = -1,
            WeatherRefreshMinutes = int.MaxValue,
            TemperatureUnit = "kelvin",
            Theme = (ThemePreset)999,
            Accent = (AccentPreset)999,
            Density = (LayoutDensity)999,
        });
        Assert.Equal("#f97316", value.CustomAccent);
        Assert.Equal(5, value.CodexRefreshMinutes);
        Assert.Equal(180, value.WeatherRefreshMinutes);
        Assert.Equal("celsius", value.TemperatureUnit);
        Assert.Equal(ThemePreset.System, value.Theme);
        Assert.Equal(AccentPreset.Orange, value.Accent);
        Assert.Equal(LayoutDensity.Comfortable, value.Density);
        Assert.Equal(1, value.SettingsSchemaVersion);
    }

    [Fact]
    public void LegacyDefaultAccentMigratesOnceWithoutRemovingRoseChoice()
    {
        var legacy = SettingsStore.Validate(new AppSettings
        {
            Accent = AccentPreset.Rose,
            SettingsSchemaVersion = 0,
        });
        var explicitRose = SettingsStore.Validate(legacy with { Accent = AccentPreset.Rose });

        Assert.Equal(AccentPreset.Orange, legacy.Accent);
        Assert.Equal(1, legacy.SettingsSchemaVersion);
        Assert.Equal(AccentPreset.Rose, explicitRose.Accent);
    }

    [Fact]
    public async Task CorruptJsonReturnsEmptyState()
    {
        using var temporary = TemporaryDirectory.Create();
        Directory.CreateDirectory(temporary.Paths.Cache);
        var path = Path.Combine(temporary.Paths.Cache, "test.json");
        await File.WriteAllTextAsync(path, "{broken");
        var store = new JsonFileStore<Dictionary<string, string>>(path);
        Assert.Null(await store.ReadAsync());
    }

    [Fact]
    public async Task AtomicStoreReplacesExistingDocument()
    {
        using var temporary = TemporaryDirectory.Create();
        var path = Path.Combine(temporary.Paths.Data, "state.json");
        var store = new JsonFileStore<Dictionary<string, int>>(path);
        await store.WriteAsync(new Dictionary<string, int> { ["value"] = 1 });
        await store.WriteAsync(new Dictionary<string, int> { ["value"] = 2 });
        Assert.Equal(2, (await store.ReadAsync())?["value"]);
        Assert.Empty(Directory.GetFiles(temporary.Paths.Data, "*.tmp"));
    }

    [Fact]
    public void LoggerRedactsBearerAndApiKeyShapes()
    {
        var redacted = RedactingLogger.Redact("Bearer secret-value sk-example123456789 access_token=abc");
        Assert.DoesNotContain("secret-value", redacted, StringComparison.Ordinal);
        Assert.DoesNotContain("example123456789", redacted, StringComparison.Ordinal);
        Assert.DoesNotContain("=abc", redacted, StringComparison.Ordinal);
    }
}

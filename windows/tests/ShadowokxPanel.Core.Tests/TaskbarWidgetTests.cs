using ShadowokxPanel.Core.AI;
using ShadowokxPanel.Core.Presentation;
using ShadowokxPanel.Core.Presentation.Taskbar;

namespace ShadowokxPanel.Core.Tests;

public sealed class TaskbarWidgetTests
{
    [Theory]
    [InlineData(TaskbarWidgetMode.Auto, TaskbarIntegrationState.Supported, TaskbarResolvedMode.Integrated)]
    [InlineData(TaskbarWidgetMode.Auto, TaskbarIntegrationState.Unknown, TaskbarResolvedMode.Overlay)]
    [InlineData(TaskbarWidgetMode.Auto, TaskbarIntegrationState.Unsupported, TaskbarResolvedMode.Overlay)]
    [InlineData(TaskbarWidgetMode.Integrated, TaskbarIntegrationState.Supported, TaskbarResolvedMode.Integrated)]
    [InlineData(TaskbarWidgetMode.Integrated, TaskbarIntegrationState.Unknown, TaskbarResolvedMode.Overlay)]
    [InlineData(TaskbarWidgetMode.Integrated, TaskbarIntegrationState.Unsupported, TaskbarResolvedMode.Overlay)]
    [InlineData(TaskbarWidgetMode.Overlay, TaskbarIntegrationState.Supported, TaskbarResolvedMode.Overlay)]
    public void ModeResolutionFailsSafe(TaskbarWidgetMode requested, TaskbarIntegrationState state, TaskbarResolvedMode expected)
    {
        Assert.Equal(expected, TaskbarWidgetGeometry.Resolve(requested, state));
    }

    [Fact]
    public void MascotAndHeightFollowTheRealTaskbarHeight()
    {
        Assert.Equal(28, TaskbarWidgetGeometry.MascotSize(48));
        Assert.Equal(40, TaskbarWidgetGeometry.MascotSize(96));
        Assert.Equal(14, TaskbarWidgetGeometry.MascotSize(10));
        Assert.True(TaskbarWidgetGeometry.WidgetHeight(48) <= 48);
        Assert.True(TaskbarWidgetGeometry.WidgetHeight(32) <= 32);
        Assert.True(TaskbarWidgetGeometry.WidgetHeight(64) <= 64);
    }

    [Fact]
    public void WidgetIsPlacedAtTheExtremeLeftAndVerticallyCentered()
    {
        var taskbar = new ScreenRect(0, 1040, 1920, 48);
        var height = TaskbarWidgetGeometry.WidgetHeight(48);
        var rect = TaskbarWidgetGeometry.Place(taskbar, 96, height);
        Assert.Equal(TaskbarWidgetGeometry.LeftMarginPx, rect.X);
        Assert.Equal((48 - height) / 2, rect.Y - 1040);
        Assert.Equal(96, rect.Width);
        Assert.True(rect.Right <= taskbar.Right);
    }

    [Fact]
    public void DpiScalesTheVerticalPadding()
    {
        Assert.Equal(3, TaskbarWidgetGeometry.Scaled(3, 1.0));
        Assert.Equal(4, TaskbarWidgetGeometry.Scaled(3, 1.25));
        Assert.Equal(5, TaskbarWidgetGeometry.Scaled(3, 1.5));
    }

    [Theory]
    [InlineData(true, true, false, false, false, true)]
    [InlineData(false, true, false, false, false, false)]
    [InlineData(true, false, false, false, false, false)]
    [InlineData(true, true, true, false, false, false)]
    [InlineData(true, true, false, true, false, false)]
    [InlineData(true, true, false, false, true, false)]
    public void VisibilityNeverDrawsWhenTheShellWouldNot(
        bool enabled, bool present, bool hidden, bool autoHideSuppressed, bool fullscreen, bool expected)
    {
        Assert.Equal(expected, TaskbarWidgetGeometry.ShouldShow(enabled, present, hidden, autoHideSuppressed, fullscreen));
    }

    [Fact]
    public void BusyIsOnlyEverARealTask()
    {
        Assert.False(TaskbarWidgetState.From(false, false, 57, "commandcode", "Command Code").Busy);
        // Application presence alone is not part of this API at all.
        Assert.True(TaskbarWidgetState.From(true, false, 57, "codex", "Codex").Busy);
        Assert.True(TaskbarWidgetState.From(false, true, 57, "commandcode", "Command Code").Busy);
    }

    [Fact]
    public void OptionalFeatureReturnsTheInstanceWhenItInitializes()
    {
        var created = new object();
        var failed = false;
        var result = OptionalFeature.TryInitialize<object>(() => created,
            (_, _) => failed = true);
        Assert.Same(created, result);
        Assert.False(failed);
    }

    [Fact]
    public void OptionalFeatureIsolatesFailuresSoTheHostSurvives()
    {
        string? reported = null;
        Exception? captured = null;
        // Mirrors the real EntryPointNotFoundException from a bad native declaration.
        var result = OptionalFeature.TryInitialize<object>(
            () => throw new EntryPointNotFoundException("Unable to find an entry point named 'GetTextExtentPoint32' in DLL 'user32.dll'."),
            (stage, error) => { reported = stage; captured = error; });
        Assert.Null(result);
        Assert.Equal("initialization failed", reported);
        Assert.IsType<EntryPointNotFoundException>(captured);
    }

    [Fact]
    public void OptionalFeatureAllowsAFeatureToDecline()
    {
        var failed = false;
        var result = OptionalFeature.TryInitialize<object>(() => null, (_, _) => failed = true);
        Assert.Null(result);
        Assert.False(failed);
    }

    [Fact]
    public void PercentageMatchesTheSharedRemainingValue()
    {
        Assert.Equal(57, AllowanceValue.Normalize(57.4));
        Assert.Equal(100, AllowanceValue.Normalize(150));
        Assert.Null(AllowanceValue.Normalize(double.NaN));
        Assert.Equal(57, AllowanceValue.Codex(57, 12));
        Assert.Equal(12, AllowanceValue.Codex(null, 12));
        Assert.Null(AllowanceValue.Codex(null, null));

        var now = DateTimeOffset.Parse("2026-10-06T12:00:00Z", System.Globalization.CultureInfo.InvariantCulture);
        var usage = new AIUsage(
            [new AIWindow("Weekly allowance", 43, null)], [], null, null, null, now, false, null, null);
        Assert.Equal(57, AllowanceValue.Provider(usage, now));

        var expired = new AIUsage(
            [new AIWindow("Weekly allowance", 43, now.AddMinutes(-5))], [], null, null, null, now, false, null, null);
        Assert.Null(AllowanceValue.Provider(expired, now));
        Assert.Null(AllowanceValue.Provider(null, now));
    }
}

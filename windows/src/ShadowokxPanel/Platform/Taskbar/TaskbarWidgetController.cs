using Microsoft.UI.Dispatching;
using ShadowokxPanel.Core.History;
using ShadowokxPanel.Core.Presentation.Taskbar;
using ShadowokxPanel.Services;

namespace ShadowokxPanel.Platform.Taskbar;

// Owns the taskbar companion's lifetime, mode selection, placement, animation and
// rollback. All provider/account/network logic stays in the main process; this type
// only renders state that the panel already computed.
internal sealed class TaskbarWidgetController : IDisposable
{
    private readonly TaskbarWidgetWindow _window;
    private readonly TaskbarMascotFrames _frames;
    private readonly TaskbarWidgetRenderer _renderer;
    private readonly DispatcherQueueTimer _timer;
    private readonly TaskbarInterop.WinEventProcedure _winEvent;
    private readonly Action _onClick;
    private readonly nint _foregroundHook;
    private readonly nint _locationHook;
    private TaskbarSnapshot _snapshot = TaskbarSnapshot.Missing;
    private TaskbarCompatibility _compatibility = TaskbarCompatibility.Unknown("not evaluated");
    private TaskbarResolvedMode _mode = TaskbarResolvedMode.Overlay;
    private TaskbarWidgetState _state = new(false, null, "codex", "Codex");
    private string _lastKey = string.Empty;
    private bool _enabled;
    private bool _busy;
    private bool _intro = true;
    private bool _disposed;
    private IReadOnlyList<MascotFrame> _sequence = [];
    private int _frameIndex;
    private TaskbarWidgetMode _requested;

    internal TaskbarWidgetController(DispatcherQueue dispatcher, Action onClick, bool enabled,
        TaskbarWidgetMode requested)
    {
        _requested = requested;
        _enabled = enabled;
        _onClick = onClick;
        _frames = new TaskbarMascotFrames();
        _renderer = new TaskbarWidgetRenderer(_frames);
        _window = new TaskbarWidgetWindow();
        _window.Clicked += _onClick;
        _window.ShellChanged += OnShellEvent;
        _timer = dispatcher.CreateTimer();
        _timer.IsRepeating = false;
        _timer.Tick += OnTimerTick;
        _winEvent = OnWinEvent;
        _foregroundHook = TaskbarInterop.SetWinEventHook(
            TaskbarInterop.EventSystemForeground, TaskbarInterop.EventSystemForeground, 0, _winEvent, 0, 0,
            TaskbarInterop.WineventOutOfContext | TaskbarInterop.WineventSkipOwnProcess);
        _locationHook = TaskbarInterop.SetWinEventHook(
            TaskbarInterop.EventObjectLocationChange, TaskbarInterop.EventObjectLocationChange, 0, _winEvent, 0, 0,
            TaskbarInterop.WineventOutOfContext | TaskbarInterop.WineventSkipOwnProcess);
        OnShellEvent();
    }

    internal TaskbarResolvedMode Mode => _mode;
    internal TaskbarCompatibility Compatibility => _compatibility;
    internal TaskbarSnapshot Snapshot => _snapshot;

    internal void ApplySettings(bool enabled, TaskbarWidgetMode requested)
    {
        if (_disposed || (_enabled == enabled && _requested == requested))
            return;
        _enabled = enabled;
        _requested = requested;
        OnShellEvent();
    }

    // The panel computes the remaining value once and passes it here; this never
    // recalculates allowance and never inspects processes.
    internal void Update(TaskbarWidgetState state)
    {
        if (_disposed || state == _state)
            return;
        var busyChanged = state.Busy != _state.Busy;
        var providerChanged = state.ProviderId != _state.ProviderId || state.RemainingPercent != _state.RemainingPercent;
        _state = state;
        if (providerChanged)
        {
            StartupDiagnostics.Write($"[TaskbarWidget] provider: {state.ProviderId}");
            StartupDiagnostics.Write(state.RemainingPercent is { } percent
                ? $"[TaskbarWidget] allowance: {percent}%"
                : "[TaskbarWidget] allowance: unavailable");
        }
        if (busyChanged)
            SetBusy(state.Busy);
        else
            Redraw();
    }

    private void OnShellEvent()
    {
        if (_disposed)
            return;
        _snapshot = TaskbarProbe.Capture();
        var compatibility = TaskbarProbe.EvaluateCompatibility(_snapshot);
        var resolved = TaskbarWidgetGeometry.Resolve(_requested, compatibility.State);
        if (compatibility != _compatibility || resolved != _mode)
        {
            _compatibility = compatibility;
            _mode = resolved;
            StartupDiagnostics.Write($"[TaskbarWidget] integration {compatibility.State}: {compatibility.Reason}");
            StartupDiagnostics.Write(resolved == TaskbarResolvedMode.Integrated
                ? "[TaskbarWidget] mode: integrated"
                : "[TaskbarWidget] mode: overlay fallback");
        }
        Redraw();
    }

    private void OnWinEvent(nint hook, uint eventType, nint hwnd, int objectId, int childId,
        uint thread, uint time)
    {
        if (_disposed)
            return;
        if (eventType == TaskbarInterop.EventObjectLocationChange && hwnd != _snapshot.TaskbarHandle)
            return;
        OnShellEvent();
    }

    private void Redraw()
    {
        if (_disposed)
            return;
        _snapshot = TaskbarProbe.Capture();
        var show = TaskbarWidgetGeometry.ShouldShow(_enabled, _snapshot.Present && !_snapshot.Retracted,
            false, false, _snapshot.FullscreenOccluded);
        if (!show)
        {
            _lastKey = string.Empty;
            _window.Hide();
            return;
        }
        var text = _state.RemainingPercent is { } percent ? $"{percent}%" : "—%";
        var (red, green, blue) = ColorFor(_state.RemainingPercent);
        var frameName = CurrentFrameName();
        var rendered = _renderer.Render(new TaskbarRenderRequest(text, frameName, red, green, blue), _snapshot);
        var bounds = TaskbarWidgetGeometry.Place(_snapshot.Taskbar, rendered.Width, rendered.Height);
        var key = $"{bounds.X},{bounds.Y},{rendered.Width},{rendered.Height}|{text}|{frameName}|{red},{green},{blue}";
        if (key == _lastKey)
            return;
        _lastKey = key;
        _window.Apply(rendered.Pixels, rendered.Width, rendered.Height, bounds.X, bounds.Y, true);
    }

    private string CurrentFrameName()
    {
        if (!_busy || _sequence.Count == 0)
            return TaskbarMascotFrames.IdleFrame;
        return _sequence[Math.Min(_frameIndex, _sequence.Count - 1)].Name;
    }

    private static (byte Red, byte Green, byte Blue) ColorFor(int? percent)
    {
        if (percent is { } value)
        {
            var (red, green, blue) = UsageAnalytics.CapacityColor(value);
            return (red, green, blue);
        }
        return (156, 163, 175);
    }

    private void SetBusy(bool busy)
    {
        _busy = busy;
        StartupDiagnostics.Write($"[TaskbarWidget] busy: {!busy} -> {busy}");
        if (busy)
            StartAnimation();
        else
            StopAnimation();
    }

    private void StartAnimation()
    {
        _sequence = _frames.WorkIntro.Count > 0 ? _frames.WorkIntro : _frames.WorkLoop;
        _frameIndex = 0;
        _intro = _sequence.Count > 0 && _frames.WorkIntro.Count > 0;
        StartupDiagnostics.Write("[TaskbarWidget] mascot animation started");
        Redraw();
        ScheduleNextFrame();
    }

    private void StopAnimation()
    {
        _timer.Stop();
        _sequence = [];
        _frameIndex = 0;
        _intro = true;
        StartupDiagnostics.Write("[TaskbarWidget] mascot animation stopped");
        Redraw();
    }

    private void ScheduleNextFrame()
    {
        if (_disposed || !_busy || _sequence.Count == 0)
        {
            _timer.Stop();
            return;
        }
        var frame = _sequence[Math.Min(_frameIndex, _sequence.Count - 1)];
        _timer.Interval = TimeSpan.FromMilliseconds(Math.Max(40, frame.DurationMs));
        _timer.Start();
    }

    private void OnTimerTick(DispatcherQueueTimer sender, object args)
    {
        if (_disposed || !_busy)
        {
            _timer.Stop();
            return;
        }
        if (_sequence.Count > 0)
        {
            _frameIndex++;
            if (_frameIndex >= _sequence.Count)
            {
                if (_intro && _frames.WorkLoop.Count > 0)
                {
                    _sequence = _frames.WorkLoop;
                    _intro = false;
                }
                _frameIndex = 0;
            }
        }
        Redraw();
        ScheduleNextFrame();
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _timer.Stop();
        _timer.Tick -= OnTimerTick;
        _window.Clicked -= _onClick;
        if (_foregroundHook != 0)
            TaskbarInterop.UnhookWinEvent(_foregroundHook);
        if (_locationHook != 0)
            TaskbarInterop.UnhookWinEvent(_locationHook);
        _window.Dispose();
        _renderer.Dispose();
        GC.KeepAlive(_winEvent);
    }
}

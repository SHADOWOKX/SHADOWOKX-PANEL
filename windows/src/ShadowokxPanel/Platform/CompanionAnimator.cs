using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;
using ShadowokxPanel.Core.Codex;

namespace ShadowokxPanel.Platform;

public sealed class CompanionAnimator : IDisposable
{
    private readonly Image _image;
    private readonly DispatcherTimer _motion = new();
    private readonly DispatcherTimer _activity = new() { Interval = TimeSpan.FromSeconds(2) };
    private readonly CompanionActivityReader _reader = new();
    private readonly Dictionary<string, BitmapImage> _images = [];
    private readonly Dictionary<string, (string Name, int Duration)[]> _clawd = [];
    private (string Name, int Duration)[] _sequence = [];
    private Action? _finished;
    private string _character = "octopus";
    private int _frame;
    internal bool IsWorking => _active;
    internal bool MotionRunning => _motion.IsEnabled;
    public event Action<string, string>? FrameChanged;
    public Func<bool>? ExternalWork { get; set; }
    public Func<bool>? CodexEnabled { get; set; }
    public bool VaryWork { get; set; } = true;
    private int _scene;
    private bool _visible;
    private bool _enabled;
    private bool _active;
    private bool _reading;
    private bool _disposed;
    private int _generation;

    public CompanionAnimator(Image image)
    {
        _image = image;
        var path = Path.Combine(AppContext.BaseDirectory, "Assets", "Companions", "octopus", "animations.json");
        using var manifest = JsonDocument.Parse(File.ReadAllText(path));
        foreach (var name in new[] { "wake", "workIntro", "workLoop", "workOutro", "complete" })
            _clawd[name] = manifest.RootElement.GetProperty(name).EnumerateArray()
                .Select(frame => (frame[0].GetString()!.Replace(".svg", ".png", StringComparison.Ordinal), frame[1].GetInt32())).ToArray();
        foreach (var scene in manifest.RootElement.GetProperty("active").EnumerateArray())
        {
            var frames = scene.EnumerateArray().Select(frame => (frame[0].GetString()!.Replace(".svg", ".png", StringComparison.Ordinal), frame[1].GetInt32())).ToArray();
            var name = frames[0].Item1.Split('-')[0];
            _clawd[name] = frames;
        }
        _motion.Tick += MotionTick;
        _activity.Tick += ActivityTick;
        Show("robot-awake.png");
    }

    public void Configure(string character, bool visible, bool animations)
    {
        character = character is "robot" or "codex" or "octopus" or "penguin" ? character : "octopus";
        if (_character == character && _visible == visible && _enabled == animations) return;
        _generation++;
        _motion.Stop(); _activity.Stop();
        _character = character; _visible = visible; _enabled = animations;
        if (!visible) { Show("robot-awake.png"); return; }
        if (!animations) { Show("robot-awake.png"); return; }
        _activity.Start();
        if (_active) StartWork(true);
        else Idle();
        ActivityTick(null, null);
    }

    private async void ActivityTick(object? sender, object? args)
    {
        if (_reading || !_visible || !_enabled || _disposed) return;
        _reading = true;
        var generation = _generation;
        try
        {
            var state = await Task.Run(() => _reader.ReadAsync());
            if (_disposed || generation != _generation) return;
            var active = (state.Active && (CodexEnabled?.Invoke() ?? true)) || (ExternalWork?.Invoke() ?? false);
            if (active == _active) return;
            _active = active;
            if (_active) StartWork(true);
            else Idle();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        { if (!_disposed && generation == _generation) { _active = false; Idle(); } }
        finally { _reading = false; }
    }

    private void StartWork(bool intro)
    {
        if (!_active) { Idle(); return; }
        if (_character == "octopus")
        {
            if (intro) { _scene = 0; Play(_clawd["workIntro"], () => StartWork(false)); }
            else if (!VaryWork) Play(_clawd["workLoop"], () => StartWork(false));
            else
            {
                var scene = _scene++ % 4;
                var name = scene switch { 1 => "crabwalking", 2 => "jumpinghappy", 3 => "waving", _ => "workLoop" };
                var loops = scene == 0 ? 8 : 3;
                Play(Enumerable.Range(0,loops).SelectMany(_ => _clawd[name]).ToArray(), () => StartWork(false));
            }
        }
        else
        {
            var frames = _character == "penguin" ? new[] { 1, 4, 7, 10, 13, 10, 7, 4 } :
                _character == "codex" ? [1, 2, 3, 4, 5, 4, 3, 2] : new[] { 1, 5, 12, 3, 1 };
            Play(frames.Select(frame => ($"robot-active-{frame:00}.png", 150)).ToArray(), () => StartWork(false));
        }
    }

    private void Idle() { _motion.Stop(); _finished = null; Show("robot-awake.png"); }

    private void Play((string Name, int Duration)[] sequence, Action finished)
    {
        _motion.Stop();
        if (!_visible || !_enabled || _disposed) return;
        _sequence = sequence; _finished = finished; _frame = 0;
        DisplayFrame();
    }

    private void DisplayFrame()
    {
        var frame = _sequence[_frame];
        Show(frame.Name);
        _motion.Interval = TimeSpan.FromMilliseconds(frame.Duration);
        _motion.Start();
    }

    private void MotionTick(object? sender, object? args)
    {
        _motion.Stop();
        if (++_frame < _sequence.Length) DisplayFrame();
        else _finished?.Invoke();
    }

    private void Show(string name)
    {
        var key = $"{_character}/{name}";
        if (!_images.TryGetValue(key, out var image))
        {
            image = new BitmapImage(new Uri($"ms-appx:///Assets/Companions/{key}")) { DecodePixelWidth = 96 };
            _images[key] = image;
        }
        _image.Source = image;
        FrameChanged?.Invoke(_character, name);
    }

    public void Dispose()
    {
        _disposed = true; _generation++;
        _motion.Stop(); _activity.Stop();
        _motion.Tick -= MotionTick; _activity.Tick -= ActivityTick;
        _images.Clear();
        GC.SuppressFinalize(this);
    }
}

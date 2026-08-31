using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;
using ShadowokxPanel.Services;

namespace ShadowokxPanel;

public partial class App : Application, IAsyncDisposable
{
    private readonly AppHost _host = new();
    private readonly object _lifecycleSync = new();
    private MainWindow? _window;
    private AppInstance? _instance;
    private DispatcherQueue? _dispatcher;
    private Task? _disposeTask;
    private Task? _exitTask;
    private bool _instanceSubscribed;

    public App()
    {
        InitializeComponent();
    }

    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        try
        {
            _instance = AppInstance.FindOrRegisterForKey("ShadowokxPanel.CurrentUser");
            if (!_instance.IsCurrent)
            {
                await _instance.RedirectActivationToAsync(
                    AppInstance.GetCurrent().GetActivatedEventArgs());
                await ExitAsync();
                return;
            }

            _dispatcher = DispatcherQueue.GetForCurrentThread();
            _instance.Activated += Instance_Activated;
            _instanceSubscribed = true;
            await _host.StartAsync();
            _window = new MainWindow(_host);
            var startedWithWindows = Environment.GetCommandLineArgs()
                .Any(value => value.Equals("--startup", StringComparison.OrdinalIgnoreCase));
            _window.InitializeTray();
            if (!startedWithWindows)
                _window.ShowPanel();
        }
        catch (Exception)
        {
            await ExitAsync();
        }
    }

    private void Instance_Activated(object? sender, AppActivationArguments eventArgs) =>
        _dispatcher?.TryEnqueue(() => _window?.ShowPanel());

    public Task ExitAsync()
    {
        lock (_lifecycleSync)
            return _exitTask ??= ExitCoreAsync();
    }

    public async ValueTask DisposeAsync()
    {
        Task disposeTask;
        lock (_lifecycleSync)
            disposeTask = _disposeTask ??= DisposeCoreAsync();
        await disposeTask;
        GC.SuppressFinalize(this);
    }

    private async Task ExitCoreAsync()
    {
        try
        {
            await DisposeAsync();
        }
        finally
        {
            Exit();
        }
    }

    private async Task DisposeCoreAsync()
    {
        if (_instance is not null && _instanceSubscribed)
        {
            _instance.Activated -= Instance_Activated;
            _instanceSubscribed = false;
        }
        _dispatcher = null;
        var window = _window;
        _window = null;
        try
        {
            window?.Dispose();
        }
        finally
        {
            await _host.DisposeAsync();
        }
    }
}

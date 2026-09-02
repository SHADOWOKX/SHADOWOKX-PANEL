using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using ShadowokxPanel.Services;

namespace ShadowokxPanel;

public partial class App : Application, IAsyncDisposable
{
    private readonly AppHost _host = new();
    private readonly object _lifecycleSync = new();
    private readonly DispatcherQueue _dispatcher;
    private MainWindow? _window;
    private Task? _disposeTask;
    private Task? _exitTask;
    private bool _showWhenReady;

    public App()
    {
        StartupDiagnostics.Write("App constructor entered");
        InitializeComponent();
        LogFrameworkResourceState();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        StartupDiagnostics.Write("App constructed");
    }

    private static void LogFrameworkResourceState()
    {
        var tabViewResources = LogFrameworkResource("TabViewButtonBackground");
        var buttonResources = LogFrameworkResource("ButtonBackground");
        var progressResources = LogFrameworkResource("ProgressBarBackground");
        StartupDiagnostics.Write(tabViewResources && buttonResources && progressResources
            ? "WinUI framework resources initialized"
            : "WinUI framework resources incomplete");
    }

    private static bool LogFrameworkResource(string key)
    {
        bool available;
        try
        {
            available = Current.Resources.TryGetValue(key, out var value) && value is not null;
        }
        catch (Exception error) when (error is Microsoft.UI.Xaml.Markup.XamlParseException or
            System.Runtime.InteropServices.COMException or InvalidOperationException)
        {
            available = false;
        }

        StartupDiagnostics.Write(
            $"WinUI framework resource lookup {key}: {(available ? "success" : "failure")}");
        return available;
    }

    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        StartupDiagnostics.Write("OnLaunched entered");
        try
        {
            StartupDiagnostics.Write("host initialization start");
            await _host.InitializeAsync();
            StartupDiagnostics.Write("host initialization end");

            StartupDiagnostics.Write("MainWindow construction start");
            _window = new MainWindow(_host);
            StartupDiagnostics.Write("MainWindow construction end");

            var startedWithWindows = Environment.GetCommandLineArgs()
                .Any(value => value.Equals("--startup", StringComparison.OrdinalIgnoreCase));
            StartupDiagnostics.Write("tray initialization start");
            _window.InitializeTray();
            StartupDiagnostics.Write("tray initialization successful");

            StartupDiagnostics.Write("provider startup start");
            await _host.StartProvidersAsync();
            StartupDiagnostics.Write("provider startup end");

            if (!startedWithWindows || _showWhenReady)
                _window.ShowPanel();
            _showWhenReady = false;
            StartupDiagnostics.Write("app entering steady-state");
        }
        catch (Exception error)
        {
            Environment.ExitCode = 1;
            StartupDiagnostics.WriteException("startup exception", error);
            try
            {
                await ExitAsync("startup failure");
            }
            catch (Exception shutdownError)
            {
                StartupDiagnostics.WriteException("startup cleanup failed", shutdownError);
            }
        }
    }

    internal void HandleRedirectedActivation()
    {
        StartupDiagnostics.Write("redirected activation dispatch requested");
        if (!_dispatcher.TryEnqueue(() =>
            {
                if (_window is null)
                    _showWhenReady = true;
                else
                    _window.ShowPanel();
            }))
        {
            StartupDiagnostics.Write("redirected activation dispatch rejected");
        }
    }

    internal bool IsShutdownRequested
    {
        get
        {
            lock (_lifecycleSync)
                return _exitTask is not null;
        }
    }

    public Task ExitAsync(string reason = "requested")
    {
        lock (_lifecycleSync)
        {
            if (_exitTask is null)
            {
                StartupDiagnostics.Write($"shutdown requested: {reason}");
                _exitTask = ExitCoreAsync();
            }
            return _exitTask;
        }
    }

    public async ValueTask DisposeAsync()
    {
        Task disposeTask;
        bool startedDisposal;
        lock (_lifecycleSync)
        {
            startedDisposal = _disposeTask is null;
            if (startedDisposal)
                StartupDiagnostics.Write("DisposeAsync start");
            disposeTask = _disposeTask ??= DisposeCoreAsync();
        }

        try
        {
            await disposeTask;
        }
        catch (Exception error)
        {
            if (startedDisposal)
                StartupDiagnostics.WriteException("DisposeAsync failed", error);
            throw;
        }
        finally
        {
            GC.SuppressFinalize(this);
            if (startedDisposal)
                StartupDiagnostics.Write("DisposeAsync end");
        }
    }

    private async Task ExitCoreAsync()
    {
        try
        {
            await DisposeAsync();
        }
        finally
        {
            StartupDiagnostics.Write("Application.Exit invoked");
            Exit();
        }
    }

    private async Task DisposeCoreAsync()
    {
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

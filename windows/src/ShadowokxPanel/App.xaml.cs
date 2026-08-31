using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;
using ShadowokxPanel.Services;

namespace ShadowokxPanel;

public partial class App : Application
{
    private readonly AppHost _host = new();
    private MainWindow? _window;
    private AppInstance? _instance;

    public App()
    {
        InitializeComponent();
    }

    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        _instance = AppInstance.FindOrRegisterForKey("ShadowokxPanel.CurrentUser");
        if (!_instance.IsCurrent)
        {
            await _instance.RedirectActivationToAsync(AppInstance.GetCurrent().GetActivatedEventArgs());
            Exit();
            return;
        }

        var dispatcher = DispatcherQueue.GetForCurrentThread();
        _instance.Activated += (_, _) => dispatcher.TryEnqueue(() => _window?.ShowPanel());
        await _host.StartAsync();
        _window = new MainWindow(_host);
        var startedWithWindows = Environment.GetCommandLineArgs()
            .Any(value => value.Equals("--startup", StringComparison.OrdinalIgnoreCase));
        _window.InitializeTray();
        if (!startedWithWindows)
            _window.ShowPanel();
    }

    public async Task ExitAsync()
    {
        _window?.PrepareToExit();
        await _host.DisposeAsync();
        Exit();
    }
}

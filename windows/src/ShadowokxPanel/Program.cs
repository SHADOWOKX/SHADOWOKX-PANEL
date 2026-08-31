using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;
using ShadowokxPanel.Services;

namespace ShadowokxPanel;

public static class Program
{
    private const string InstanceKey = "ShadowokxPanel.CurrentUser";
    private static readonly object LifecycleSync = new();
    private static App? _application;
    private static AppInstance? _primaryInstance;
    private static bool _activationPending;

    [STAThread]
    public static void Main()
    {
        StartupDiagnostics.Write("process entered");
        try
        {
            WinRT.ComWrappersSupport.InitializeComWrappers();
            StartupDiagnostics.Write("COM wrappers initialized");
            var currentInstance = AppInstance.GetCurrent();
            var activation = currentInstance.GetActivatedEventArgs();
            StartupDiagnostics.Write("AppInstance key lookup");
            var keyInstance = AppInstance.FindOrRegisterForKey(InstanceKey);
            if (!keyInstance.IsCurrent)
            {
                StartupDiagnostics.Write("instance decision: secondary");
                StartupDiagnostics.Write("activation redirect start");
                keyInstance.RedirectActivationToAsync(activation).AsTask()
                    .GetAwaiter().GetResult();
                StartupDiagnostics.Write("activation redirect complete; secondary exiting");
                return;
            }

            StartupDiagnostics.Write("instance decision: primary");
            _primaryInstance = keyInstance;
            keyInstance.Activated += PrimaryInstance_Activated;
            StartupDiagnostics.Write("WinUI dispatcher entering");
            Application.Start(_ =>
            {
                try
                {
                    var dispatcher = DispatcherQueue.GetForCurrentThread();
                    SynchronizationContext.SetSynchronizationContext(
                        new DispatcherQueueSynchronizationContext(dispatcher));
                    StartupDiagnostics.Write("WinUI application start callback");
                    AttachApplication(new App());
                }
                catch (Exception error)
                {
                    Environment.ExitCode = 1;
                    StartupDiagnostics.WriteException("App construction failed", error);
                    throw;
                }
            });

            SynchronizationContext.SetSynchronizationContext(null);
            App? application;
            lock (LifecycleSync)
                application = _application;
            if (application is null)
            {
                Environment.ExitCode = 1;
                StartupDiagnostics.Write("primary dispatcher exited before App was attached");
            }
            else
            {
                if (!application.IsShutdownRequested)
                {
                    Environment.ExitCode = 1;
                    StartupDiagnostics.Write("primary dispatcher exited without a shutdown request");
                }
                application.DisposeAsync().AsTask().GetAwaiter().GetResult();
            }
            StartupDiagnostics.Write("primary dispatcher exited");
        }
        catch (Exception error)
        {
            Environment.ExitCode = 1;
            StartupDiagnostics.WriteException("fatal startup exception", error);
            SynchronizationContext.SetSynchronizationContext(null);
            App? application;
            lock (LifecycleSync)
                application = _application;
            if (application is not null)
            {
                try
                {
                    application.DisposeAsync().AsTask().GetAwaiter().GetResult();
                }
                catch (Exception cleanupError)
                {
                    StartupDiagnostics.WriteException("fatal startup cleanup failed", cleanupError);
                }
            }
        }
        finally
        {
            var primary = _primaryInstance;
            if (primary is not null)
            {
                primary.Activated -= PrimaryInstance_Activated;
                try
                {
                    primary.UnregisterKey();
                }
                catch (Exception error)
                {
                    StartupDiagnostics.WriteException("AppInstance key cleanup failed", error);
                }
            }
            lock (LifecycleSync)
                _application = null;
            _primaryInstance = null;
            StartupDiagnostics.Write($"process exiting with code {Environment.ExitCode}");
        }
    }

    private static void AttachApplication(App application)
    {
        bool activate;
        lock (LifecycleSync)
        {
            _application = application;
            activate = _activationPending;
            _activationPending = false;
        }
        if (activate)
            application.HandleRedirectedActivation();
    }

    private static void PrimaryInstance_Activated(object? sender, AppActivationArguments eventArgs)
    {
        StartupDiagnostics.Write("redirected activation received by primary");
        App? application;
        lock (LifecycleSync)
        {
            application = _application;
            if (application is null)
                _activationPending = true;
        }
        application?.HandleRedirectedActivation();
    }
}

using System.Diagnostics;
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
        StartupTrace.Begin(Environment.GetCommandLineArgs());
        try
        {
            WinRT.ComWrappersSupport.InitializeComWrappers();
            StartupTrace.Write("COM wrappers initialized");
            StartupTrace.Write("checking existing instance");
            var currentInstance = AppInstance.GetCurrent();
            var activation = currentInstance.GetActivatedEventArgs();
            var keyName = Environment.GetCommandLineArgs().Contains("--ui-smoke")
                ? InstanceKey + ".Smoke." + Environment.ProcessId : InstanceKey;
            StartupTrace.Write($"instance key: {keyName}");
            var keyInstance = AppInstance.FindOrRegisterForKey(keyName);
            var otherInstances = CountOtherInstances();
            StartupTrace.Write($"registered instance is current: {keyInstance.IsCurrent}");
            StartupTrace.Write($"other running ShadowokxPanel processes: {otherInstances}");
            if (!keyInstance.IsCurrent)
            {
                // A stale key on an unpackaged build must never leave the user with no
                // window: only redirect when another instance is genuinely alive.
                if (otherInstances == 0)
                {
                    StartupTrace.Write("instance key reported secondary but no live instance exists; continuing as primary");
                }
                else
                {
                    StartupTrace.Write("existing instance found: true");
                    StartupTrace.Write("activation redirect start");
                    keyInstance.RedirectActivationToAsync(activation).AsTask()
                        .WaitAsync(TimeSpan.FromSeconds(10)).GetAwaiter().GetResult();
                    StartupTrace.Write("activation redirect complete");
                    StartupTrace.Exit("secondary instance: redirected activation to the primary instance");
                    return;
                }
            }

            StartupTrace.Write("primary instance");
            _primaryInstance = keyInstance;
            keyInstance.Activated += PrimaryInstance_Activated;
            StartupTrace.Write("entering WinUI dispatcher");
            Application.Start(_ =>
            {
                try
                {
                    var dispatcher = DispatcherQueue.GetForCurrentThread();
                    SynchronizationContext.SetSynchronizationContext(
                        new DispatcherQueueSynchronizationContext(dispatcher));
                    StartupTrace.Write("WinUI application start callback");
                    AttachApplication(new App());
                }
                catch (Exception error)
                {
                    Environment.ExitCode = 1;
                    StartupTrace.Failure("App construction failed", error);
                    StartupTrace.Exit("App construction failed");
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
                StartupTrace.Exit("dispatcher exited before App was attached");
            }
            else
            {
                if (!application.IsShutdownRequested)
                {
                    Environment.ExitCode = 1;
                    StartupTrace.Exit("dispatcher exited without a shutdown request");
                }
                application.DisposeAsync().AsTask().GetAwaiter().GetResult();
                StartupTrace.Write("application disposed");
            }
            StartupTrace.Write("dispatcher exited");
        }
        catch (Exception error)
        {
            Environment.ExitCode = 1;
            StartupTrace.Failure("fatal startup exception", error);
            StartupTrace.Exit("fatal startup exception");
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
                    StartupTrace.Failure("fatal startup cleanup failed", cleanupError);
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
                    StartupTrace.Failure("AppInstance key cleanup failed", error);
                }
            }
            lock (LifecycleSync)
                _application = null;
            _primaryInstance = null;
            StartupTrace.Write($"process exiting code={Environment.ExitCode}");
        }
    }

    private static int CountOtherInstances()
    {
        try
        {
            using var self = Process.GetCurrentProcess();
            var count = 0;
            foreach (var process in Process.GetProcessesByName(self.ProcessName))
            {
                using (process)
                {
                    if (process.Id != Environment.ProcessId)
                        count++;
                }
            }
            return count;
        }
        catch (Exception error)
        {
            StartupTrace.Failure("instance enumeration failed", error);
            return -1;
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
        StartupTrace.Write("redirected activation received by primary");
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

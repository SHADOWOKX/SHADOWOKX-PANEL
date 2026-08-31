using Microsoft.Win32;

namespace ShadowokxPanel.Platform;

public static class StartupService
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "ShadowokxPanel";

    public static bool IsEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, false);
            return key?.GetValue(ValueName) is string;
        }
        catch (Exception error) when (error is UnauthorizedAccessException or System.Security.SecurityException)
        {
            return false;
        }
    }

    public static void SetEnabled(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey, true) ??
            throw new UnauthorizedAccessException("The current-user startup key is unavailable.");
        if (!enabled)
        {
            key.DeleteValue(ValueName, false);
            return;
        }
        var executable = Environment.ProcessPath ??
            throw new InvalidOperationException("Application executable path is unavailable.");
        key.SetValue(ValueName, $"\"{executable}\" --startup", RegistryValueKind.String);
    }
}

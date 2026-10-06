namespace ShadowokxPanel.Core.Presentation.Taskbar;

// Optional companion features must never take down the host application. This is the
// single, tested policy used when creating one: if the factory throws for any reason
// (including a missing native entry point), the failure is reported and the caller
// continues with null.
public static class OptionalFeature
{
    public static T? TryInitialize<T>(Func<T?> factory, Action<string, Exception> onFailure)
        where T : class
    {
        ArgumentNullException.ThrowIfNull(factory);
        ArgumentNullException.ThrowIfNull(onFailure);
        try
        {
            return factory();
        }
        catch (Exception error)
        {
            onFailure("initialization failed", error);
            return null;
        }
    }
}

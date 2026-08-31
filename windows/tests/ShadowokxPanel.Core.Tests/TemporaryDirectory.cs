using ShadowokxPanel.Core.Storage;

namespace ShadowokxPanel.Core.Tests;

internal sealed class TemporaryDirectory : IDisposable
{
    private TemporaryDirectory(string root)
    {
        Root = root;
        Paths = new ApplicationPaths(root);
    }

    internal string Root { get; }
    internal ApplicationPaths Paths { get; }

    internal static TemporaryDirectory Create()
    {
        var root = Path.Combine(Path.GetTempPath(), "shadowokx-panel-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        return new TemporaryDirectory(root);
    }

    public void Dispose()
    {
        try { Directory.Delete(Root, true); }
        catch (IOException) { }
    }
}

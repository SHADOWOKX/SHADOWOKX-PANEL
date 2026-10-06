namespace ShadowokxPanel.Core.Tests;

// Explicit POSIX fixture for discovery tests: no real filesystem, no host paths, no
// OperatingSystem checks. Registered paths are matched exactly and path joining always
// uses '/', so the test behaves identically on Windows and Linux.
internal sealed class FakePosixFileSystem
{
    private readonly HashSet<string> _files = new(StringComparer.Ordinal);

    internal FakePosixFileSystem Add(string path)
    {
        _files.Add(path);
        return this;
    }

    internal bool Exists(string path) => _files.Contains(path);

    internal static bool IsAbsolute(string directory) =>
        directory.Length > 0 && directory[0] == '/';

    internal static string Combine(string directory, string name) => $"{directory}/{name}";

    internal static string Join(params string[] segments) => string.Join('/', segments);
}

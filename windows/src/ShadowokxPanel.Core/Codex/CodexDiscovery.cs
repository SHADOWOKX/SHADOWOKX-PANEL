using ShadowokxPanel.Core.Models;

namespace ShadowokxPanel.Core.Codex;

public static class CodexDiscovery
{
    private static readonly string[] Names = ["codex.exe", "codex.cmd", "codex.bat"];

    public static CodexLaunchSpec? Find(
        IReadOnlyDictionary<string, string?>? environment = null,
        Func<string, bool>? fileExists = null)
    {
        string? Get(string name) => environment is null
            ? Environment.GetEnvironmentVariable(name)
            : environment.TryGetValue(name, out var value) ? value : null;
        fileExists ??= File.Exists;

        var candidates = new List<string>();
        foreach (var directory in (Get("PATH") ?? string.Empty)
            .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            AddNames(candidates, directory);
        }

        var profile = Get("USERPROFILE");
        var local = Get("LOCALAPPDATA");
        var roaming = Get("APPDATA");
        var programFiles = Get("PROGRAMFILES");
        var programFilesX86 = Get("PROGRAMFILES(X86)");
        var userDirectories = new[]
        {
            Join(profile, ".local", "bin"),
            Join(profile, "bin"),
            Join(roaming, "npm"),
            Join(local, "pnpm"),
            Get("PNPM_HOME"),
            Join(profile, ".bun", "bin"),
            Join(Get("BUN_INSTALL"), "bin"),
            Join(profile, ".volta", "bin"),
            Join(Get("VOLTA_HOME"), "bin"),
            Get("NVM_SYMLINK"),
            Join(roaming, "nvm"),
            Join(profile, "scoop", "shims"),
            Join(Get("ChocolateyInstall"), "bin"),
            Join(local, "Microsoft", "WindowsApps"),
            Join(local, "Programs", "Codex"),
            Join(local, "Programs", "OpenAI", "Codex"),
            Join(programFiles, "Codex"),
            Join(programFiles, "OpenAI", "Codex"),
            Join(programFilesX86, "Codex"),
        };
        foreach (var directory in userDirectories.Where(value => value is not null))
            AddNames(candidates, directory!);

        foreach (var path in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!IsSafeAbsolutePath(path) || !fileExists(path))
                continue;
            var extension = System.IO.Path.GetExtension(path);
            var shim = extension.Equals(".cmd", StringComparison.OrdinalIgnoreCase) ||
                extension.Equals(".bat", StringComparison.OrdinalIgnoreCase);
            if (shim && path.IndexOfAny(['"', '\r', '\n', '%', '!', '&', '|', '<', '>', '^']) >= 0)
                continue;
            return new CodexLaunchSpec(path, shim);
        }
        return null;
    }

    private static void AddNames(List<string> candidates, string directory)
    {
        var clean = directory.Trim().Trim('"').TrimEnd('\\', '/');
        if (string.IsNullOrWhiteSpace(clean))
            return;
        foreach (var name in Names)
            candidates.Add($"{clean}\\{name}");
    }

    private static string? Join(string? root, params string[] parts)
    {
        if (string.IsNullOrWhiteSpace(root))
            return null;
        return string.Join('\\', new[] { root.Trim().TrimEnd('\\', '/') }.Concat(parts));
    }

    private static bool IsSafeAbsolutePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.IndexOfAny(['\0', '"', '\r', '\n']) >= 0)
            return false;
        return path.StartsWith("\\\\", StringComparison.Ordinal) ||
            path.Length >= 3 && char.IsAsciiLetter(path[0]) && path[1] == ':' &&
            (path[2] == '\\' || path[2] == '/');
    }
}

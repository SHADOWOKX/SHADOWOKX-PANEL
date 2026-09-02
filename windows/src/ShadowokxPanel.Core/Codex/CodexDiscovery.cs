using ShadowokxPanel.Core.Models;
using Microsoft.Win32;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace ShadowokxPanel.Core.Codex;

public static class CodexDiscovery
{
    private static readonly string[] Names = ["codex.exe", "codex.cmd", "codex.bat"];

    public static CodexLaunchSpec? Find(
        IReadOnlyDictionary<string, string?>? environment = null,
        Func<string, bool>? fileExists = null,
        IEnumerable<string?>? additionalPathValues = null,
        IEnumerable<string?>? appPathCandidates = null,
        IEnumerable<string?>? additionalSearchRoots = null,
        Func<string, IEnumerable<string>>? enumerateExecutables = null)
    {
        string? Get(string name) => environment is null
            ? Environment.GetEnvironmentVariable(name)
            : environment.TryGetValue(name, out var value) ? value : null;
        fileExists ??= File.Exists;

        var candidates = new List<string>();
        var pathValues = new List<string?> { Get("PATH") };
        if (additionalPathValues is not null)
            pathValues.AddRange(additionalPathValues);
        else if (environment is null && OperatingSystem.IsWindows())
        {
            pathValues.Add(ReadEnvironmentPath(EnvironmentVariableTarget.User));
            pathValues.Add(ReadEnvironmentPath(EnvironmentVariableTarget.Machine));
        }
        foreach (var directory in pathValues
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => environment is null
                ? Environment.ExpandEnvironmentVariables(value!) : value!)
            .SelectMany(value => value.Split(';',
                StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)))
        {
            AddNames(candidates, directory);
        }

        var registeredExecutables = appPathCandidates;
        if (registeredExecutables is null && environment is null && OperatingSystem.IsWindows())
            registeredExecutables = ReadAppPaths();
        foreach (var path in registeredExecutables ?? [])
        {
            if (!string.IsNullOrWhiteSpace(path))
                candidates.Add((environment is null
                    ? Environment.ExpandEnvironmentVariables(path) : path).Trim().Trim('"'));
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
            Join(profile, ".codex", "packages", "standalone", "current", "bin"),
            Join(profile, ".codex", "packages", "standalone", "current"),
            Join(roaming, "npm"),
            Join(local, "npm"),
            Join(local, "pnpm"),
            Get("PNPM_HOME"),
            Join(profile, ".bun", "bin"),
            Join(Get("BUN_INSTALL"), "bin"),
            Join(profile, ".volta", "bin"),
            Join(Get("VOLTA_HOME"), "bin"),
            Get("NVM_SYMLINK"),
            Get("NVM_HOME"),
            Join(roaming, "nvm"),
            Join(profile, "scoop", "shims"),
            Join(Get("ChocolateyInstall"), "bin"),
            Join(local, "Microsoft", "WindowsApps"),
            Join(local, "Programs", "Codex"),
            Join(local, "OpenAI", "Codex"),
            Join(local, "Programs", "OpenAI", "Codex", "bin"),
            Join(local, "Programs", "OpenAI", "Codex"),
            Join(local, "Programs", "ChatGPT", "resources", "codex"),
            Join(local, "Programs", "OpenAI", "ChatGPT", "resources", "codex"),
            Join(programFiles, "Codex"),
            Join(programFiles, "OpenAI", "Codex"),
            Join(programFilesX86, "Codex"),
        };
        foreach (var directory in userDirectories.Where(value => value is not null))
            AddNames(candidates, directory!);

        var direct = FindFirst(candidates, fileExists);
        if (direct is not null)
            return direct;

        var searchRoots = new List<string?>
        {
            Join(profile, ".codex", "packages", "standalone", "current"),
            Join(roaming, "npm", "node_modules", "@openai", "codex"),
            Join(local, "pnpm", "global"),
            Get("NVM_HOME"),
            Join(local, "Programs", "Codex"),
            Join(local, "Codex"),
            Join(local, "OpenAI", "Codex"),
            Join(local, "Programs", "OpenAI", "Codex"),
            Join(local, "Programs", "ChatGPT"),
            Join(local, "Programs", "OpenAI", "ChatGPT"),
        };
        if (additionalSearchRoots is not null)
            searchRoots.AddRange(additionalSearchRoots);
        else if (environment is null && OperatingSystem.IsWindows())
            searchRoots.AddRange(ReadRegisteredInstallRoots());

        enumerateExecutables ??= environment is null && OperatingSystem.IsWindows()
            ? EnumerateExecutables : null;
        if (enumerateExecutables is null)
            return null;
        var nested = new List<string>();
        foreach (var root in searchRoots
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => Environment.ExpandEnvironmentVariables(value!))
            .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            nested.AddRange(enumerateExecutables(root));
        }
        return FindFirst(nested
            .OrderBy(CandidateArchitectureRank)
            .ThenBy(CandidateKindRank)
            .ThenBy(path => path.Length), fileExists);
    }

    private static CodexLaunchSpec? FindFirst(
        IEnumerable<string> candidates,
        Func<string, bool> fileExists)
    {
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

    private static int CandidateArchitectureRank(string path)
    {
        var expected = RuntimeInformation.ProcessArchitecture == Architecture.Arm64
            ? new[] { "aarch64", "arm64" }
            : new[] { "x86_64", "win-x64", "x64" };
        if (expected.Any(token => path.Contains(token, StringComparison.OrdinalIgnoreCase)))
            return 0;
        var architectureSpecific = new[] { "aarch64", "arm64", "x86_64", "win-x64", "x64" };
        return architectureSpecific.Any(token =>
            path.Contains(token, StringComparison.OrdinalIgnoreCase)) ? 2 : 1;
    }

    private static int CandidateKindRank(string path) =>
        System.IO.Path.GetExtension(path).Equals(".exe", StringComparison.OrdinalIgnoreCase) ? 0 : 1;

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

    private static IEnumerable<string> EnumerateExecutables(string root)
    {
        if (!IsSafeAbsolutePath(root) || !Directory.Exists(root))
            yield break;
        var options = new EnumerationOptions
        {
            RecurseSubdirectories = true,
            IgnoreInaccessible = true,
            MaxRecursionDepth = 12,
            AttributesToSkip = FileAttributes.ReparsePoint,
            MatchCasing = MatchCasing.CaseInsensitive,
        };
        foreach (var name in Names)
        {
            IEnumerator<string> iterator;
            try { iterator = Directory.EnumerateFiles(root, name, options).GetEnumerator(); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or
                System.Security.SecurityException or ArgumentException)
            {
                continue;
            }
            using (iterator)
            {
                while (true)
                {
                    string current;
                    try
                    {
                        if (!iterator.MoveNext())
                            break;
                        current = iterator.Current;
                    }
                    catch (Exception error) when (error is IOException or UnauthorizedAccessException or
                        System.Security.SecurityException)
                    {
                        break;
                    }
                    yield return current;
                }
            }
        }
    }

    private static string? ReadEnvironmentPath(EnvironmentVariableTarget target)
    {
        try { return Environment.GetEnvironmentVariable("PATH", target); }
        catch (Exception error) when (error is System.Security.SecurityException or
            PlatformNotSupportedException or ArgumentException)
        {
            return null;
        }
    }

    [SupportedOSPlatform("windows")]
    private static List<string?> ReadAppPaths()
    {
        var paths = new List<string?>();
        foreach (var hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
        {
            foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            {
                try
                {
                    using var baseKey = RegistryKey.OpenBaseKey(hive, view);
                    using var key = baseKey.OpenSubKey(
                        @"Software\Microsoft\Windows\CurrentVersion\App Paths\codex.exe",
                        writable: false);
                    if (key?.GetValue(null) is string path)
                        paths.Add(path);
                }
                catch (Exception error) when (error is System.Security.SecurityException or
                    UnauthorizedAccessException or IOException or ArgumentException)
                {
                    // Registry discovery is optional; other deterministic sources remain available.
                }
            }
        }
        return paths;
    }

    [SupportedOSPlatform("windows")]
    private static List<string?> ReadRegisteredInstallRoots()
    {
        var roots = new List<string?>();
        foreach (var hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
        {
            foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            {
                try
                {
                    using var baseKey = RegistryKey.OpenBaseKey(hive, view);
                    using var uninstall = baseKey.OpenSubKey(
                        @"Software\Microsoft\Windows\CurrentVersion\Uninstall", writable: false);
                    foreach (var name in uninstall?.GetSubKeyNames() ?? [])
                    {
                        using var application = uninstall?.OpenSubKey(name, writable: false);
                        var displayName = application?.GetValue("DisplayName") as string ?? string.Empty;
                        var publisher = application?.GetValue("Publisher") as string ?? string.Empty;
                        var isOpenAi = displayName.Contains("OpenAI", StringComparison.OrdinalIgnoreCase) ||
                            publisher.Contains("OpenAI", StringComparison.OrdinalIgnoreCase);
                        var isCodexHost = displayName.Contains("Codex", StringComparison.OrdinalIgnoreCase) ||
                            displayName.Contains("ChatGPT", StringComparison.OrdinalIgnoreCase);
                        if (!isOpenAi || !isCodexHost)
                            continue;
                        roots.Add(application?.GetValue("InstallLocation") as string);
                        if (application?.GetValue("DisplayIcon") is string displayIcon)
                        {
                            var clean = displayIcon.Split(',', 2)[0].Trim().Trim('"');
                            roots.Add(System.IO.Path.GetDirectoryName(clean));
                        }
                    }
                }
                catch (Exception error) when (error is System.Security.SecurityException or
                    UnauthorizedAccessException or IOException or ArgumentException)
                {
                    // Per-user deterministic paths remain available when registry access is blocked.
                }
            }
        }
        return roots;
    }
}

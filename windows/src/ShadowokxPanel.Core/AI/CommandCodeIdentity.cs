using System.Text.RegularExpressions;

namespace ShadowokxPanel.Core.AI;

// Canonical Command Code identity for Windows. Exact tokens and specific paths
// only; a loose substring such as "cmd" must never classify an unrelated process
// (notably the Windows command shell, cmd.exe).
//
// Verified against the installed desktop app (productName "Command Code",
// package @commandcode/desktop):
//   desktop executable:   %LOCALAPPDATA%\Programs\Command Code\Command Code.exe
//   helpers:              the same executable with --type=zygote|gpu-process|renderer|utility|broker
//   Electron bundle:      --app-path=...\resources\app
//   Electron data:        --user-data-dir=...\Command Code
//   CLI (npm):            command-code package => ...\command-code\dist\cli.mjs, bins cmd / cmdc
public static partial class CommandCodeIdentity
{
    private static readonly HashSet<string> AppIds =
        new(StringComparer.Ordinal) { "command-code", "commandcode", "command code", "com.commandcode.app", "@commandcode/desktop" };

    // Exact basenames of the user-facing desktop binary. Deliberately excludes the
    // CLI bins (cmd/cmdc) and every "-desktop" wildcard.
    private static readonly HashSet<string> DesktopBinaries =
        new(StringComparer.Ordinal) { "command-code", "commandcode", "command code" };

    private static readonly HashSet<string> GenericDesktopHosts =
        new(StringComparer.Ordinal) { "electron", "electron.exe", "chrome", "google-chrome", "google-chrome-stable",
            "chromium", "brave", "msedge", "microsoft-edge", "cmd" };

    private static readonly HashSet<string> RuntimeNames =
        new(StringComparer.Ordinal) { "node", "node.exe", "bun", "bun.exe", "python", "python3", "python.exe" };

    [GeneratedRegex("(^|[/\\\\])(command-code|@commandcode[/\\\\]desktop)([/\\\\]|$)", RegexOptions.IgnoreCase)]
    private static partial Regex PackagePath();

    [GeneratedRegex("(^|[/\\\\])command[ _-]?code[/\\\\]resources[/\\\\]app([/\\\\]|$)", RegexOptions.IgnoreCase)]
    private static partial Regex AppPath();

    [GeneratedRegex("--user-data-dir=.*[/\\\\]command[ _-]?code([/\\\\]|$)", RegexOptions.IgnoreCase)]
    private static partial Regex UserData();

    [GeneratedRegex("(^|[\\s\\0])--type=")]
    private static partial Regex HelperRole();

    private static string BaseName(string? path)
    {
        var value = path ?? string.Empty;
        var index = Math.Max(value.LastIndexOf('/'), value.LastIndexOf('\\'));
        return index >= 0 ? value[(index + 1)..] : value;
    }

    private static string NormalizeBase(string? value)
    {
        var name = BaseName(value).Trim().ToLowerInvariant();
        return name.EndsWith(".exe", StringComparison.Ordinal) ? name[..^4] : name;
    }

    public static bool IsGenericDesktopHost(string? name) =>
        GenericDesktopHosts.Contains(NormalizeBase(name)) || GenericDesktopHosts.Contains((name ?? string.Empty).ToLowerInvariant());

    public static bool IsApplication(string? appId = null, string? desktopId = null, string? wmClass = null,
        string? executable = null, IReadOnlyList<string>? argv = null)
    {
        foreach (var identifier in new[] { appId, desktopId, wmClass })
        {
            var value = (identifier ?? string.Empty).Trim().ToLowerInvariant();
            if (value.EndsWith(".desktop", StringComparison.Ordinal)) value = value[..^8];
            if (AppIds.Contains(value)) return true;
        }
        var exe = executable ?? string.Empty;
        if (DesktopBinaries.Contains(NormalizeBase(exe))) return true;
        if (PackagePath().IsMatch(exe) || AppPath().IsMatch(exe)) return true;
        var args = argv ?? [];
        if (args.Count > 0 && DesktopBinaries.Contains(NormalizeBase(args[0]))) return true;
        foreach (var argument in args)
            if (AppPath().IsMatch(argument) || UserData().IsMatch(argument) || PackagePath().IsMatch(argument))
                return true;
        return false;
    }

    // Classify a single process:
    //   desktop-main   the user-facing desktop process (no Electron helper role)
    //   desktop-helper an Electron zygote/gpu/renderer/utility/broker process
    //   cli            the Command Code CLI (strong npm signature only)
    //   null           not Command Code
    public static string? ProcessRole(string? comm, string? executable = null, IReadOnlyList<string>? argv = null)
    {
        var name = (comm ?? string.Empty).Trim().ToLowerInvariant();
        var exe = executable ?? string.Empty;
        var baseName = NormalizeBase(exe);
        if (baseName.Length == 0) baseName = name;
        var args = argv ?? [];
        var raw = string.Join('\0', args);
        var helperRole = HelperRole().IsMatch(raw);
        var strongPackage = PackagePath().IsMatch(exe) || PackagePath().IsMatch(raw);

        if (DesktopBinaries.Contains(baseName))
            return helperRole ? "desktop-helper" : "desktop-main";

        if (IsGenericDesktopHost(name))
        {
            if (AppPath().IsMatch(raw) || UserData().IsMatch(raw))
                return helperRole ? "desktop-helper" : "desktop-main";
            return null;
        }

        // cmd / cmdc are far too generic to match by name. cmd.exe in particular is
        // the Windows shell, never Command Code, unless the npm payload is proven.
        if (name is "cmd" or "cmdc" or "commandcode")
            return strongPackage ? "cli" : null;

        if (RuntimeNames.Contains(name))
            return strongPackage ? "cli" : null;

        return null;
    }

    public static bool IsCandidate(string? executable = null, IReadOnlyList<string>? argv = null)
    {
        var args = argv ?? [];
        var text = string.Join(' ', new[] { BaseName(executable) }.Concat(args));
        return Candidate().IsMatch(text);
    }

    [GeneratedRegex("command[ _-]?code", RegexOptions.IgnoreCase)]
    private static partial Regex Candidate();
}

public sealed record CommandCodeProcessSnapshot(string Name, string? Executable, IReadOnlyList<string> Arguments, bool HasWindow);
public sealed record CommandCodePresence(bool Open, string Source);

public interface ICommandCodeProcessSource
{
    IReadOnlyList<CommandCodeProcessSnapshot> Capture();
}

// Presence only. Application presence is never work and never animates the mascot.
public sealed class CommandCodeProcessMonitor(ICommandCodeProcessSource? source = null)
{
    private readonly ICommandCodeProcessSource _source = source ?? new WindowsProcessSource();

    public CommandCodePresence Sample()
    {
        var desktopWindow = false;
        var main = false;
        var cli = false;
        var helper = false;
        foreach (var process in _source.Capture())
        {
            var role = CommandCodeIdentity.ProcessRole(process.Name, process.Executable, process.Arguments);
            switch (role)
            {
                case "desktop-main":
                    main = true;
                    if (process.HasWindow) desktopWindow = true;
                    break;
                case "desktop-helper":
                    helper = true;
                    break;
                case "cli":
                    cli = true;
                    break;
            }
        }
        var active = desktopWindow || main || cli;
        var origin = desktopWindow ? "desktop-app" : main ? "main-process" : cli ? "cli"
            : helper ? "electron-helper" : "none";
        return new(active, origin);
    }
}

public sealed class WindowsProcessSource : ICommandCodeProcessSource
{
    public IReadOnlyList<CommandCodeProcessSnapshot> Capture()
    {
        var snapshots = new List<CommandCodeProcessSnapshot>();
        if (!OperatingSystem.IsWindows())
            return snapshots;
        System.Diagnostics.Process[] processes;
        try { processes = System.Diagnostics.Process.GetProcesses(); }
        catch (InvalidOperationException) { return snapshots; }
        foreach (var process in processes)
        {
            using (process)
            {
                try
                {
                    string? executable = null;
                    try { executable = process.MainModule?.FileName; }
                    catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException or NotSupportedException) { }
                    var hasWindow = process.MainWindowHandle != 0;
                    snapshots.Add(new(process.ProcessName, executable, [], hasWindow));
                }
                catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception) { }
            }
        }
        return snapshots;
    }
}

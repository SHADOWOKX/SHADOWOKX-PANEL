using System.Runtime.InteropServices;
using System.Text;

namespace ShadowokxPanel.Core.AI;

// The key is stored only in Windows Credential Manager. There is no plaintext
// fallback, and background reads never prompt for an unlock.
public interface ICommandCodeKeyStore
{
    Task<string?> ReadAsync(CancellationToken cancellationToken = default);
    Task SaveAsync(string key, CancellationToken cancellationToken = default);
    Task ClearAsync(CancellationToken cancellationToken = default);
}

public sealed class WindowsCredentialKeyStore : ICommandCodeKeyStore
{
    internal const string Target = "ShadowokxPanel/CommandCode/api-key";
    private const int CredTypeGeneric = 1;
    private const int CredPersistLocalMachine = 2;

    public static WindowsCredentialKeyStore Instance { get; } = new();

    public Task<string?> ReadAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!OperatingSystem.IsWindows())
            throw new CommandCodeException("keyring-unavailable");
        if (!CredRead(Target, CredTypeGeneric, 0, out var handle))
        {
            var error = Marshal.GetLastPInvokeError();
            // ERROR_NOT_FOUND (1168): the key was never stored.
            if (error != 1168)
                throw new CommandCodeException("keyring-unavailable");
            return Task.FromResult<string?>(null);
        }
        try
        {
            var credential = Marshal.PtrToStructure<Credential>(handle);
            if (credential.CredentialBlobSize <= 0 || credential.CredentialBlob == 0)
                return Task.FromResult<string?>(null);
            var blob = new byte[credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, blob, 0, blob.Length);
            var key = Encoding.Unicode.GetString(blob);
            return Task.FromResult<string?>(key.Length > 0 ? CommandCodeUsage.ValidateKey(key) : null);
        }
        finally
        {
            CredFree(handle);
        }
    }

    public Task SaveAsync(string key, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        CommandCodeUsage.ValidateKey(key);
        if (!OperatingSystem.IsWindows())
            throw new CommandCodeException("keyring-unavailable");
        var blob = Encoding.Unicode.GetBytes(key);
        var blobPointer = Marshal.AllocHGlobal(blob.Length);
        var targetPointer = Marshal.StringToCoTaskMemUni(Target);
        var userPointer = Marshal.StringToCoTaskMemUni("Command Code");
        try
        {
            Marshal.Copy(blob, 0, blobPointer, blob.Length);
            var credential = new Credential
            {
                Type = CredTypeGeneric,
                TargetName = targetPointer,
                CredentialBlob = blobPointer,
                CredentialBlobSize = blob.Length,
                Persist = CredPersistLocalMachine,
                UserName = userPointer,
            };
            if (!CredWrite(ref credential, 0))
                throw new CommandCodeException("keyring-write-failed");
        }
        finally
        {
            Marshal.FreeHGlobal(blobPointer);
            Marshal.FreeCoTaskMem(targetPointer);
            Marshal.FreeCoTaskMem(userPointer);
        }
        return Task.CompletedTask;
    }

    public Task ClearAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!OperatingSystem.IsWindows())
            throw new CommandCodeException("keyring-unavailable");
        if (!CredDelete(Target, CredTypeGeneric, 0) && Marshal.GetLastPInvokeError() != 1168)
            throw new CommandCodeException("keyring-unavailable");
        return Task.CompletedTask;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public int Flags;
        public int Type;
        public nint TargetName;
        public nint Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public nint CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public nint Attributes;
        public nint TargetAlias;
        public nint UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, int type, int reservedFlag, out nint credentialPtr);

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref Credential credential, int flags);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, int type, int flags);

    [DllImport("advapi32.dll", EntryPoint = "CredFree", SetLastError = true)]
    private static extern void CredFree(nint buffer);
}

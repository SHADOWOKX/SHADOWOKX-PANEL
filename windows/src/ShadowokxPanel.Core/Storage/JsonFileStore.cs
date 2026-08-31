using System.Text.Json;
using System.Diagnostics.CodeAnalysis;

namespace ShadowokxPanel.Core.Storage;

[SuppressMessage("Design", "CA1001:Types that own disposable fields should be disposable",
    Justification = "SemaphoreSlim does not allocate a wait handle unless AvailableWaitHandle is used, which this bounded process-lifetime store never does.")]
public sealed class JsonFileStore<T>(string path, JsonSerializerOptions? options = null)
{
    private const int MaximumBytes = 1_048_576;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _options = options ?? new(JsonSerializerDefaults.Web);

    public string Path { get; } = System.IO.Path.GetFullPath(path);

    public async Task<T?> ReadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (!File.Exists(Path))
                return default;
            var info = new FileInfo(Path);
            if (info.Length is < 0 or > MaximumBytes)
                return default;
            await using var stream = new FileStream(
                Path, FileMode.Open, FileAccess.Read, FileShare.Read,
                16 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
            return await JsonSerializer.DeserializeAsync<T>(stream, _options, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (JsonException)
        {
            return default;
        }
        catch (IOException)
        {
            return default;
        }
        catch (UnauthorizedAccessException)
        {
            return default;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task WriteAsync(T value, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        string? temporary = null;
        try
        {
            var directory = System.IO.Path.GetDirectoryName(Path) ??
                throw new InvalidOperationException("Storage path has no parent directory.");
            Directory.CreateDirectory(directory);
            temporary = System.IO.Path.Combine(
                directory,
                $".{System.IO.Path.GetFileName(Path)}.{Guid.NewGuid():N}.tmp");
            await using (var stream = new FileStream(
                temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                16 * 1024, FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(stream, value, _options, cancellationToken)
                    .ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
                if (stream.Length > MaximumBytes)
                    throw new InvalidDataException("Stored JSON exceeds the safe size limit.");
            }

            File.Move(temporary, Path, true);
            temporary = null;
        }
        finally
        {
            if (temporary is not null)
            {
                try { File.Delete(temporary); }
                catch (IOException) { }
            }
            _gate.Release();
        }
    }

    public async Task DeleteAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (File.Exists(Path))
                File.Delete(Path);
        }
        finally
        {
            _gate.Release();
        }
    }
}

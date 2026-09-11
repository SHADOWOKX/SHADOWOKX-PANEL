using System.Text;

namespace ShadowokxPanel.Core.IO;

// Bounds allocation before a newline arrives, including malformed child-process output.
public sealed class BoundedLineReader(TextReader reader, int maximumCharacters = 1_048_576, bool skipOversized = false)
{
    private readonly char[] _buffer = new char[8192];
    private int _position;
    private int _length;
    public bool SkippedOversized { get; private set; }

    public async ValueTask<string?> ReadLineAsync(CancellationToken cancellationToken = default)
    {
        var line = new StringBuilder();
        var dropping = false;
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (_position == _length)
            {
                _length = await reader.ReadAsync(_buffer.AsMemory(), cancellationToken).ConfigureAwait(false);
                _position = 0;
                if (_length == 0)
                    return dropping || line.Length == 0 ? null : line.ToString().TrimEnd('\r');
            }
            var end = Array.IndexOf(_buffer, '\n', _position, _length - _position);
            var count = (end < 0 ? _length : end) - _position;
            if (!dropping && line.Length + count > maximumCharacters)
            {
                if (!skipOversized) throw new InvalidDataException("A record exceeds the supported size limit.");
                dropping = true;
                SkippedOversized = true;
                line.Clear();
            }
            if (!dropping) line.Append(_buffer, _position, count);
            _position += count;
            if (end >= 0)
            {
                _position++;
                if (dropping) { dropping = false; continue; }
                return line.ToString().TrimEnd('\r');
            }
        }
    }
}

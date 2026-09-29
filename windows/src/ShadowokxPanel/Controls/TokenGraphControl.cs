using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using ShadowokxPanel.Core.Models;
using ShadowokxPanel.Core.Presentation;
using Windows.Foundation;
using XamlPath = Microsoft.UI.Xaml.Shapes.Path;

namespace ShadowokxPanel.Controls;

// Eight grouped paths replace hundreds of per-day controls and event handlers.
public sealed class TokenGraphControl : Canvas
{
    private IReadOnlyList<UsageBucket> _buckets = [];
    private bool _weekly;
    private ActivityCell? _hovered;
    private DateOnly _today;
    private readonly TextBlock _caption = new() { FontSize = 9, TextTrimming = TextTrimming.CharacterEllipsis };
    private readonly List<TextBlock> _labels = [];
    private readonly List<XamlPath> _paths = [];
    private double _size, _stepX, _stepY, _left, _top;
    public ActivityCalendar Activity { get; private set; } = AccountActivity.Create(null, DateOnly.FromDateTime(DateTime.Now), false);

    public TokenGraphControl()
    {
        Height = 84;
        MinWidth = 120;
        Background = new SolidColorBrush(Windows.UI.Color.FromArgb(1, 0, 0, 0));
        Children.Add(_caption);
        for (var i = 0; i < 8; i++) { var path = new XamlPath { IsHitTestVisible = false }; _paths.Add(path); Children.Add(path); }
        for (var i = 0; i < 12; i++) { var label = new TextBlock { FontSize = 9, IsHitTestVisible = false }; _labels.Add(label); Children.Add(label); }
        SizeChanged += (_, _) => Render();
        PointerMoved += (_, e) =>
        {
            var position = e.GetCurrentPoint(this).Position;
            var column = (int)Math.Floor((position.X - _left) / _stepX);
            var row = (int)Math.Floor((position.Y - _top) / _stepY);
            var cell = Activity.Cells.FirstOrDefault(c => c.Column == column && c.Row == row);
            if (cell is null || position.Y < _top || position.Y > _top + Activity.Rows * _stepY) { ResetCaption(); return; }
            if (ReferenceEquals(cell, _hovered)) return;
            _hovered = cell;
            var tokens = cell.Tokens.HasValue ? cell.Tokens.Value.ToString("N0", CultureInfo.CurrentCulture) + " tokens" : "Not reported";
            var coverage = _weekly ? $" · {cell.ReportedDays}/{cell.ExpectedDays} days" : string.Empty;
            _caption.Text = $"{cell.Date:MMM d, yyyy} · {tokens}{coverage}";
            AutomationProperties.SetName(this, _caption.Text);
        };
        PointerExited += (_, _) => ResetCaption();
    }

    public void SetData(IReadOnlyList<UsageBucket>? buckets)
    {
        var today = DateOnly.FromDateTime(DateTime.Now);
        var next = buckets ?? [];
        if (_today == today && _buckets.SequenceEqual(next)) return;
        _today = today;
        _buckets = next.ToArray();
        Activity = AccountActivity.Create(_buckets, today, _weekly);
        Render();
    }
    public void SetWeekly(bool weekly)
    {
        if (_weekly == weekly) return;
        _weekly = weekly;
        Activity = AccountActivity.Create(_buckets, DateOnly.FromDateTime(DateTime.Now), weekly);
        Render();
    }
    public void RefreshTheme() => Render();

    private void ResetCaption()
    {
        _hovered = null;
        _caption.Text = _weekly ? "WEEKLY TOTALS · REPORTED ACCOUNT DAYS" : "DAILY TOKENS · LAST 12 MONTHS";
    }

    private void Render()
    {
        if (ActualWidth <= 0) return;
        var accent = (ResourceBrush("AccentBrush") as SolidColorBrush)?.Color ?? Windows.UI.Color.FromArgb(255, 249, 115, 22);
        var groups = Enumerable.Range(0, 8).Select(_ => new GeometryGroup()).ToArray();
        var columns = Math.Max(1, Activity.Columns);
        _size = Math.Max(1, Math.Min(_weekly ? 11 : 6.5, (ActualWidth - 2 - 1.5 * (columns - 1)) / columns));
        _stepX = _weekly ? (ActualWidth - _size - 2) / Math.Max(1, columns - 1) : _size + 1.5;
        _stepY = _size + (_weekly ? 2 : 1.5);
        _left = (ActualWidth - _stepX * (columns - 1) - _size) / 2;
        _top = 17 + (54 - Activity.Rows * _stepY + (_stepY - _size)) / 2;
        var peak = Activity.Peak?.Tokens ?? 0;
        foreach (var cell in Activity.Cells)
        {
            var level = cell.Tokens is null ? 0 : cell.Tokens == 0 ? 1 :
                2 + (int)Math.Round(5 * Math.Sqrt((double)cell.Tokens.Value / Math.Max(1, peak)));
            groups[level].Children.Add(new RectangleGeometry
            { Rect = new Rect(_left + cell.Column * _stepX, _top + cell.Row * _stepY, _size, _size) });
        }
        for (var i = 0; i < _paths.Count; i++)
        {
            _paths[i].Data = groups[i];
            _paths[i].Fill = i < 2 ? ResourceBrush("SecondaryTextBrush") : new SolidColorBrush(accent);
            _paths[i].Opacity = i == 0 ? .10 : i == 1 ? .24 : .30 + .70 * (i - 2) / 5;
        }
        _caption.Foreground = ResourceBrush("SecondaryTextBrush");
        _caption.Width = ActualWidth;
        ResetCaption();
        for (var i = 0; i < _labels.Count; i++)
        {
            var label = _labels[i];
            label.Foreground = ResourceBrush("SecondaryTextBrush");
            label.Visibility = !_weekly || i < 2 ? Visibility.Visible : Visibility.Collapsed;
            label.Text = _weekly ? (i == 0 ? Activity.Start : Activity.End).ToString("MMM d", CultureInfo.CurrentCulture)
                : Activity.Start.AddMonths(i).ToString("MMM", CultureInfo.CurrentCulture);
            label.Width = _weekly ? ActualWidth / 2 : ActualWidth / 12;
            label.TextAlignment = _weekly && i == 1 ? TextAlignment.Right : TextAlignment.Left;
            SetLeft(label, _weekly ? i * ActualWidth / 2 : i * ActualWidth / 12);
            SetTop(label, 71);
        }
    }
    private static Brush ResourceBrush(string key) => (Brush)Application.Current.Resources[key];
}

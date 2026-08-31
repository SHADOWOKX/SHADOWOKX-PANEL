using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using ShadowokxPanel.Core.History;
using ShadowokxPanel.Core.Models;
using ShadowokxPanel.Services;
using Windows.Foundation;
using XamlPath = Microsoft.UI.Xaml.Shapes.Path;

namespace ShadowokxPanel.Controls;

public sealed class TokenGraphControl : Canvas
{
    private IReadOnlyList<UsageBucket> _buckets = [];

    public TokenGraphControl()
    {
        StartupDiagnostics.Write("TokenGraphControl constructor entered");
        Height = 92;
        MinWidth = 120;
        SizeChanged += (_, _) => Render();
        StartupDiagnostics.Write("TokenGraphControl constructor completed");
    }

    public void SetData(IReadOnlyList<UsageBucket>? buckets)
    {
        var next = buckets ?? [];
        if (_buckets.SequenceEqual(next))
            return;
        _buckets = next.ToArray();
        Render();
    }

    private void Render()
    {
        Children.Clear();
        if (ActualWidth <= 0 || ActualHeight <= 0)
            return;
        var graphHeight = Math.Max(30, ActualHeight - 22);
        var points = GraphMath.Calculate(_buckets, ActualWidth, graphHeight, 7, 7);
        if (points.Count < 2)
        {
            Children.Add(new TextBlock
            {
                Text = "Not enough history yet",
                Foreground = ResourceBrush("SecondaryTextBrush"),
                FontSize = 12,
                Margin = new Thickness(2, 24, 0, 0),
            });
            return;
        }

        var areaFigure = new PathFigure
        {
            StartPoint = new Point(points[0].X, graphHeight - 2),
            IsClosed = true,
        };
        areaFigure.Segments.Add(new LineSegment { Point = new Point(points[0].X, points[0].Y) });
        AddCurve(areaFigure, points);
        areaFigure.Segments.Add(new LineSegment { Point = new Point(points[^1].X, graphHeight - 2) });
        var areaGeometry = new PathGeometry();
        areaGeometry.Figures.Add(areaFigure);
        var accent = (ResourceBrush("AccentBrush") as SolidColorBrush)?.Color ??
            Windows.UI.Color.FromArgb(255, 244, 63, 94);
        Children.Add(new XamlPath
        {
            Data = areaGeometry,
            Fill = new LinearGradientBrush
            {
                StartPoint = new Point(0, 0),
                EndPoint = new Point(0, 1),
                GradientStops =
                {
                    new GradientStop { Color = Windows.UI.Color.FromArgb(70, accent.R, accent.G, accent.B), Offset = 0 },
                    new GradientStop { Color = Windows.UI.Color.FromArgb(0, accent.R, accent.G, accent.B), Offset = 1 },
                },
            },
        });

        var lineFigure = new PathFigure { StartPoint = new Point(points[0].X, points[0].Y) };
        AddCurve(lineFigure, points);
        var lineGeometry = new PathGeometry();
        lineGeometry.Figures.Add(lineFigure);
        Children.Add(new XamlPath
        {
            Data = lineGeometry,
            Stroke = ResourceBrush("AccentBrush"),
            StrokeThickness = 2,
            StrokeLineJoin = PenLineJoin.Round,
            StrokeStartLineCap = PenLineCap.Round,
            StrokeEndLineCap = PenLineCap.Round,
        });

        foreach (var point in points)
        {
            var newest = point == points[^1];
            var marker = new Ellipse
            {
                Width = newest ? 8 : 4,
                Height = newest ? 8 : 4,
                Fill = ResourceBrush("AccentBrush"),
                Stroke = newest ? ResourceBrush("PrimaryTextBrush") : null,
                StrokeThickness = newest ? 1.5 : 0,
            };
            SetLeft(marker, point.X - marker.Width / 2);
            SetTop(marker, point.Y - marker.Height / 2);
            ToolTipService.SetToolTip(marker,
                $"{point.Date.ToString("MMM d", CultureInfo.CurrentCulture)}\n{FormatTokens(point.Tokens)} tokens");
            Children.Add(marker);

            var label = new TextBlock
            {
                Text = FirstTextElement(
                    point.Date.ToString("ddd", CultureInfo.CurrentCulture)),
                Foreground = ResourceBrush("SecondaryTextBrush"),
                FontSize = 10,
                HorizontalTextAlignment = TextAlignment.Center,
                Width = 18,
            };
            SetLeft(label, Math.Clamp(point.X - 9, 0, Math.Max(0, ActualWidth - 18)));
            SetTop(label, graphHeight + 3);
            Children.Add(label);
        }
    }

    private static void AddCurve(PathFigure figure, IReadOnlyList<GraphPoint> points)
    {
        for (var index = 1; index < points.Count; index++)
        {
            var previous = points[index - 1];
            var current = points[index];
            var delta = (current.X - previous.X) / 3;
            figure.Segments.Add(new BezierSegment
            {
                Point1 = new Point(previous.X + delta, previous.Y),
                Point2 = new Point(current.X - delta, current.Y),
                Point3 = new Point(current.X, current.Y),
            });
        }
    }

    private static Brush ResourceBrush(string name) =>
        (Brush)Application.Current.Resources[name];

    private static string FirstTextElement(string value) =>
        string.IsNullOrEmpty(value) ? value : StringInfo.GetNextTextElement(value);

    private static string FormatTokens(long tokens) => tokens switch
    {
        >= 1_000_000_000 => tokens.ToString("0.#,,,'B'", CultureInfo.CurrentCulture),
        >= 1_000_000 => tokens.ToString("0.#,,'M'", CultureInfo.CurrentCulture),
        >= 1_000 => tokens.ToString("0.#,'K'", CultureInfo.CurrentCulture),
        _ => tokens.ToString("N0", CultureInfo.CurrentCulture),
    };
}

using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Shapes;
using ShadowokxPanel.Core.AI;
using ShadowokxPanel.Core.History;
using ShadowokxPanel.Core.Presentation;
namespace ShadowokxPanel;
public sealed partial class MainWindow
{
    private static readonly CultureInfo UiCulture = CultureInfo.CurrentCulture;
    private readonly Dictionary<string,SvgImageSource> _providerImages = [];
    private readonly SvgImageSource _weatherTabImage = new(new Uri("ms-appx:///Assets/Weather/clear-day.svg"));
    private SvgImageSource ProviderLogo(string id)
    {
        if (!_providerImages.TryGetValue(id,out var source))
        {
            source = new SvgImageSource(new Uri($"ms-appx:///Assets/Providers/{id}-symbolic.svg"));
            _providerImages[id] = source;
        }
        return source;
    }
    private string SelectedAI => _host.Settings.Current.SelectedProvider;
    private bool OtherAI => _viewModel.SelectedPage != "weather" && SelectedAI != "codex";
    private void AIChanged(object? sender, EventArgs args) => DispatcherQueue.TryEnqueue(() =>
    {
        if (_disposed) return;
        if (_visible && OtherAI) { RenderAI(); QueueContentResize(); }
        UpdateTray();
    });
    private void RenderProviderTabs()
    {
        ProviderTabs.Children.Clear(); ProviderTabs.RowDefinitions.Clear(); ProviderTabs.ColumnDefinitions.Clear();
        var ids=_host.Settings.Current.VisibleProviders.Where(id=>!_host.Settings.Current.RemovedProviders.Contains(id)).ToArray();
        if (!ids.Contains(SelectedAI) && ids.Length>0)
            _ = _host.Settings.SaveAsync(_host.Settings.Current with { SelectedProvider=ids[0] });
        var pages=ids.ToList();
        if (_host.Settings.Current.ShowWeather) pages.Add("weather");
        ProviderBorder.Visibility = pages.Count > 1 ? Visibility.Visible : Visibility.Collapsed;
        var columns=Math.Max(1,pages.Count);
        for (var c=0;c<columns;c++) ProviderTabs.ColumnDefinitions.Add(new ColumnDefinition { Width=new GridLength(1,GridUnitType.Star) });
        for (var r=0;r<(pages.Count+columns-1)/columns;r++) ProviderTabs.RowDefinitions.Add(new RowDefinition { Height=GridLength.Auto });
        for (var i=0;i<pages.Count;i++)
        {
            var id=pages[i];
            var content=new StackPanel { Orientation=Orientation.Horizontal,Spacing=6,HorizontalAlignment=HorizontalAlignment.Center };
            content.Children.Add(new Border { Background=ResourceBrush("CardHoverBrush"), CornerRadius=new CornerRadius(5), Padding=new Thickness(3), Child=new Image { Source=id=="weather"?_weatherTabImage:ProviderLogo(id), Width=16,Height=16 } });
            if (pages.Count <= 2)
                content.Children.Add(new TextBlock { Text=id=="codex"?"ChatGPT Codex":id=="weather"?"Weather":AICatalog.Providers[id], FontSize=12, VerticalAlignment=VerticalAlignment.Center });
            var button=new Button { Content=content,CornerRadius=new CornerRadius(9),Height=36,MinWidth=0,Padding=new Thickness(3),HorizontalAlignment=HorizontalAlignment.Stretch,
                Background=(id=="weather"?_viewModel.SelectedPage=="weather":_viewModel.SelectedPage!="weather" && SelectedAI==id)?ResourceBrush("AccentBrush",.12):Transparent(),BorderBrush=(id=="weather"?_viewModel.SelectedPage=="weather":_viewModel.SelectedPage!="weather" && SelectedAI==id)?ResourceBrush("AccentBrush",.45):Transparent() };
            AutomationProperties.SetName(button,id=="weather"?"Weather":AICatalog.Providers[id]);
            ToolTipService.SetToolTip(button,id=="weather"?"Weather":AICatalog.Providers[id]);
            button.Click+=async (_,_)=> {
                if (id=="weather") await _viewModel.SelectPageAsync("weather");
                else { await _host.Settings.SaveAsync(_host.Settings.Current with { SelectedProvider=id }); await _viewModel.SelectPageAsync("codex"); }
                Render();
            };
            Grid.SetRow(button,i/columns);Grid.SetColumn(button,i%columns);ProviderTabs.Children.Add(button);
        }
    }
    private void RenderAI()
    {
        AIContent.Children.Clear();
        if (!AICatalog.Contains(SelectedAI)) return;
        var state=_host.AI.State(SelectedAI);
        AIContent.Children.Add(Label(AICatalog.Providers[SelectedAI]+" Usage", 17, "PrimaryTextBrush", true));
        if (SelectedAI == "commandcode" && state.Usage is { Source: "commandcode-api" } nativeUsage)
        {
            RenderCommandCodeNative(state, nativeUsage);
            AIContent.Children.Add(CommandCodeActions());
            return;
        }
        void Card(string title,string value,string? detail=null, double? remaining=null)
        {
            var stack=new StackPanel { Spacing=6 };
            stack.Children.Add(Label(title, 14, "PrimaryTextBrush", true));
            stack.Children.Add(Label(value, 26, "AccentBrush", true, wrap: true));
            if (remaining is { } percentage)
                stack.Children.Add(ProgressMeter(percentage, CapacityColor(percentage)));
            if (detail is not null) stack.Children.Add(Label(detail, 12, "SecondaryTextBrush", wrap: true));
            AIContent.Children.Add(CardFrame(stack));
        }
        if (state.Usage is { } usage)
        {
            if (SelectedAI == "commandcode")
            {
                AIContent.Children.Add(Label("Live account consumption: Unavailable", 12, "SecondaryTextBrush", wrap: true));
                AIContent.Children.Add(Label("Configured usage JSON · not an automatic account feed", 11, "MetaTextBrush", wrap: true));
            }
            foreach (var window in usage.Windows.Where(w=>w.ResetsAt is null || w.ResetsAt>DateTimeOffset.UtcNow))
            {
                var remaining = AllowanceStatus.Remaining(window.UsedPercent);
                Card(window.Label, remaining is { } value ? $"{value:0}% remaining" : "Unavailable",
                    window.ResetsAt is { } reset?FormatCountdown(reset):null, remaining);
            }
            foreach (var balance in usage.Balances) Card("Account balance",$"{balance.Amount:0.##} {balance.Currency}");
            if (usage.Tokens is { } tokens) Card("Tokens",$"{tokens:N0}");
            AIContent.Children.Add(Label($"{usage.Account} {usage.Plan} · Updated {usage.UpdatedAt.LocalDateTime:g}{(state.Stale?" · Cached":"")}", 11, "MetaTextBrush", wrap: true));
        }
        if (state.Error is not null || state.Usage is null)
            Card(SelectedAI == "commandcode" ? "Live account consumption" : "Connection",state.Usage is null ? SelectedAI == "commandcode" ? "Unavailable" : "Connect your account" : "Cached data",state.Error ?? "Choose a usage source in Settings.");
        if (SelectedAI == "commandcode")
        {
            var reference = CommandCodeReference.Goat;
            var stack = new StackPanel { Spacing=5 };
            stack.Children.Add(Label(reference.Title, 14, "PrimaryTextBrush", true));
            foreach (var text in new[] { reference.Price,reference.Limits,reference.Note,reference.Checked })
                stack.Children.Add(Label(text, 12, "SecondaryTextBrush", wrap: true));
            var docs = ToolbarButton("View plan limits");
            docs.Click += async (_,_) => await OpenCommandCodePageAsync(docs,reference.Source);
            stack.Children.Add(docs);
            AIContent.Children.Add(CardFrame(stack));
            AIContent.Children.Add(CommandCodeActions());
            return;
        }
        AIContent.Children.Add(ActionToolbar(
            ("Connection settings", () => OpenSettings(), null),
            ("Refresh", null, async () => await _host.AI.RefreshAsync())));
    }

    // Native live Command Code account view. The weekly allowance is the hero card; the
    // five-hour window is a compact row; monthly consumption, requests and credit
    // balances use compact account rows with one shared right edge. Values, labels,
    // thresholds and calculations are unchanged — this is presentation only.
    private void RenderCommandCodeNative(AIState state, AIUsage data)
    {
        var consumption = data.Consumption;
        AIWindow? WindowFor(string title) => data.Windows.FirstOrDefault(window => window.Label == title &&
            (window.ResetsAt is null || window.ResetsAt > DateTimeOffset.UtcNow));
        var weekly = WindowFor("Weekly allowance");
        var fiveHour = WindowFor("Five-hour allowance");
        var percent = weekly is null ? null : AllowanceStatus.Remaining(weekly.UsedPercent);

        var hero = new StackPanel { Spacing = 8 };
        var heading = new Grid();
        heading.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        heading.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        heading.Children.Add(Label("Weekly allowance", 14, "PrimaryTextBrush", true, center: true));
        var pill = StatusPill(state, data, percent);
        Grid.SetColumn(pill, 1);
        heading.Children.Add(pill);
        hero.Children.Add(heading);

        if (percent is { } remaining)
        {
            var color = CapacityColor(remaining);
            var valueRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
            var weeklyValue = Label($"{remaining:0}%", 40, null, true, bold: true);
            weeklyValue.Foreground = new SolidColorBrush(color);
            valueRow.Children.Add(weeklyValue);
            var unit = Label("remaining", 12, "SecondaryTextBrush");
            unit.VerticalAlignment = VerticalAlignment.Bottom;
            unit.Margin = new Thickness(0, 0, 0, 7);
            valueRow.Children.Add(unit);
            if (weekly is { } window)
                ToolTipService.SetToolTip(valueRow, $"{Amount(window.Used)} / {Amount(window.Cap)} credits consumed · {window.UsedPercent:0.##}% used");
            hero.Children.Add(valueRow);
            hero.Children.Add(ProgressMeter(remaining, color));
        }
        else
        {
            hero.Children.Add(Label("Unavailable", 20, "SecondaryTextBrush"));
        }

        var rows = new StackPanel { Spacing = 0, Margin = new Thickness(0, 6, 0, 0) };
        rows.Children.Add(new TextBlock { Text = "ACCOUNT USAGE", Style = (Style)Application.Current.Resources["SectionLabelStyle"], Margin = new Thickness(0, 0, 0, 4) });
        rows.Children.Add(StatRow("Monthly · consumed credits", Amount(consumption?.MonthlyUsedCredits)));
        rows.Children.Add(StatRow("Requests · reported period", Amount(consumption?.Requests)));
        rows.Children.Add(StatRow("Weekly · consumed / limit", weekly is { } week ? $"{Amount(week.Used)} / {Amount(week.Cap)}" : "Unavailable"));
        var period = consumption is { PeriodStart: { } start, PeriodEnd: { } end }
            ? $"{start.LocalDateTime.ToString("MMM d", UiCulture)} – {end.LocalDateTime.ToString("MMM d", UiCulture)}"
            : consumption?.PeriodBasis ?? "Period unavailable";
        var note = Label($"Account period · {period}", 11, "MetaTextBrush", wrap: true);
        note.Margin = new Thickness(0, 4, 0, 0);
        ToolTipService.SetToolTip(note, $"Reported usage period: {consumption?.PeriodBasis ?? "Unavailable"}. Monthly allowance cap is not reported; no percentage is estimated.");
        rows.Children.Add(note);
        hero.Children.Add(rows);

        hero.Children.Add(new Border { Height = 1, Background = ResourceBrush("CardBorderBrush"), Margin = new Thickness(0, 10, 0, 8) });
        var reset = new Grid();
        reset.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        reset.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var countdown = Label(weekly?.ResetsAt is { } resetAt ? FormatCountdown(resetAt) : "Reset unavailable", 13, "PrimaryTextBrush", true);
        countdown.TextTrimming = TextTrimming.CharacterEllipsis;
        reset.Children.Add(countdown);
        var resetDate = Label(weekly?.ResetsAt is { } date ? date.LocalDateTime.ToString("ddd h:mm tt", UiCulture) : string.Empty, 12, "SecondaryTextBrush");
        resetDate.HorizontalAlignment = HorizontalAlignment.Right;
        Grid.SetColumn(resetDate, 1);
        reset.Children.Add(resetDate);
        hero.Children.Add(reset);
        AIContent.Children.Add(CardFrame(hero));

        var five = new Grid();
        five.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        five.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var fiveCopy = new StackPanel { Spacing = 3, VerticalAlignment = VerticalAlignment.Center };
        fiveCopy.Children.Add(Label("5-Hour Window", 14, "PrimaryTextBrush", true));
        fiveCopy.Children.Add(Label(fiveHour?.ResetsAt is { } fiveReset ? FormatCountdown(fiveReset) : "Reset unavailable", 11, "SecondaryTextBrush"));
        five.Children.Add(fiveCopy);
        var fiveRemaining = fiveHour is null ? null : AllowanceStatus.Remaining(fiveHour.UsedPercent);
        var fiveValue = Label(fiveRemaining is { } value ? $"{value:0}% remaining" : "Unavailable", 15, null, true);
        fiveValue.VerticalAlignment = VerticalAlignment.Center;
        fiveValue.Foreground = fiveRemaining is { } tone ? new SolidColorBrush(CapacityColor(tone)) : ResourceBrush("SecondaryTextBrush");
        if (fiveHour is { } fiveWindow)
            ToolTipService.SetToolTip(fiveValue, $"{Amount(fiveWindow.Used)} / {Amount(fiveWindow.Cap)} credits consumed · {(fiveWindow.UsedPercent is { } used ? $"{used:0.##}% used" : "Unavailable")}");
        Grid.SetColumn(fiveValue, 1);
        five.Children.Add(fiveValue);
        AIContent.Children.Add(CardFrame(five));

        var activity = new StackPanel { Spacing = 0 };
        var activityHeading = new Grid();
        activityHeading.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        activityHeading.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        activityHeading.Children.Add(Label("Account activity", 14, "PrimaryTextBrush", true));
        var plan = Label(string.IsNullOrEmpty(data.Plan) ? "Unavailable" : data.Plan, 12, "SecondaryTextBrush", true);
        plan.HorizontalAlignment = HorizontalAlignment.Right;
        Grid.SetColumn(plan, 1);
        activityHeading.Children.Add(plan);
        activity.Children.Add(activityHeading);
        var identity = Label(string.Join(" · ", new[] { data.PlanStatus, data.Account }.Where(value => !string.IsNullOrEmpty(value))) is { Length: > 0 } text ? text : "Command Code account", 11, "MetaTextBrush", wrap: true);
        identity.Margin = new Thickness(0, 2, 0, 4);
        ToolTipService.SetToolTip(identity, "Read-only Command Code API · Refreshes every 3 minutes");
        activity.Children.Add(identity);
        activity.Children.Add(StatRow("Total consumed · credits", Amount(consumption?.UsedCredits)));
        foreach (var balance in data.CreditBalances) activity.Children.Add(StatRow(balance.Label, Amount(balance.Amount)));
        if (consumption?.PeriodEnd is { } periodEnd)
            activity.Children.Add(StatRow("Billing period ends", periodEnd.LocalDateTime.ToString("MMM d", UiCulture)));
        AIContent.Children.Add(CardFrame(activity));

        var footer = new Grid();
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var age = DateTimeOffset.Now - data.UpdatedAt;
        var relative = age.TotalSeconds < 5 ? "just now" : age.TotalMinutes < 60 ? $"{Math.Max(1, (int)age.TotalMinutes)}m ago" : $"{(int)age.TotalHours}h ago";
        var refresh = Label($"{(state.Stale ? "Cached" : "Usage checked")} {relative}", 11, "MetaTextBrush");
        refresh.HorizontalAlignment = HorizontalAlignment.Right;
        var tooltip = $"Last successful refresh: {data.UpdatedAt.LocalDateTime:g}{(state.Error is null ? string.Empty : $"\n{state.Error}")}{(data.RetryAt is { } retry && retry > DateTimeOffset.Now ? $"\nRetry after {retry.LocalDateTime:t}" : string.Empty)}";
        ToolTipService.SetToolTip(refresh, tooltip);
        Grid.SetColumn(refresh, 1);
        footer.Children.Add(refresh);
        AIContent.Children.Add(footer);
    }

    // One desktop toolbar row, always equal segments, so nothing clips at the narrowest
    // supported width. No horizontal overflow.
    private Grid CommandCodeActions() => ActionToolbar(
        ("Open usage", null, () => OpenCommandCodePageAsync(CommandCodeReference.UsageUri)),
        ("Refresh", null, () => _host.AI.RefreshAsync()),
        ("Settings", () => OpenSettings(), null));

    private static Button ToolbarButton(string label) => new()
    {
        Content = label,
        Style = (Style)Application.Current.Resources["ToolbarButtonStyle"],
    };

    private static Grid ActionToolbar(params (string Label, Action? Click, Func<Task>? Async)[] actions)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        for (var index = 0; index < actions.Length; index++)
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        for (var index = 0; index < actions.Length; index++)
        {
            var (label, click, work) = actions[index];
            var button = ToolbarButton(label);
            if (click is not null)
                button.Click += (_, _) => click();
            if (work is not null)
                button.Click += async (_, _) =>
                {
                    button.IsEnabled = false;
                    try { await work(); }
                    catch (OperationCanceledException) { }
                    finally { button.IsEnabled = true; }
                };
            Grid.SetColumn(button, index);
            grid.Children.Add(button);
        }
        AutomationProperties.SetName(grid, "Provider actions");
        return grid;
    }

    private static Border StatusPill(AIState state, AIUsage data, double? percent)
    {
        var text = state.Stale ? "Stale" : data.Warnings.Count > 0 ? "Partial"
            : percent is null ? "Unavailable" : UsageAnalytics.CapacityLabel(percent);
        var tone = state.Stale || percent is null ? ResourceBrush("SecondaryTextBrush").Color : CapacityColor(percent.Value);
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 5, VerticalAlignment = VerticalAlignment.Center };
        content.Children.Add(new Ellipse { Width = 6, Height = 6, Fill = new SolidColorBrush(tone), VerticalAlignment = VerticalAlignment.Center });
        content.Children.Add(Label(text, 11, "SecondaryTextBrush", true, center: true));
        var pill = new Border { Style = (Style)Application.Current.Resources["StatusPillStyle"], Child = content };
        ToolTipService.SetToolTip(pill, state.Error ?? (data.Warnings.Count > 0 ? "Some account metrics were not returned." : "Live Command Code account usage"));
        return pill;
    }

    // Text and fill derive from the same canonical remaining percentage, so the visible
    // fill always matches the displayed value.
    private static Grid ProgressMeter(double remaining, Windows.UI.Color color)
    {
        var track = new Grid { Height = 7, Background = ResourceBrush("TrackBrush"), CornerRadius = new CornerRadius(4), Margin = new Thickness(0, 2, 0, 0) };
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(remaining, GridUnitType.Star) });
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(100 - remaining, GridUnitType.Star) });
        var fill = new Border { Background = new SolidColorBrush(color), CornerRadius = new CornerRadius(4) };
        Grid.SetColumn(fill, 0);
        track.Children.Add(fill);
        AutomationProperties.SetName(track, $"{remaining:0.#}% remaining");
        return track;
    }

    private static Border CardFrame(UIElement child, string background = "CardBrush") => new()
    {
        Child = child, Padding = new Thickness(14), CornerRadius = new CornerRadius(14),
        Background = ResourceBrush(background), BorderBrush = ResourceBrush("CardBorderBrush"),
        BorderThickness = new Thickness(1),
    };

    private static Grid StatRow(string title, string value, string? tooltip = null)
    {
        var row = new Grid { MinHeight = 22, VerticalAlignment = VerticalAlignment.Center };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var label = Label(title, 12, "SecondaryTextBrush", center: true);
        label.TextTrimming = TextTrimming.CharacterEllipsis;
        row.Children.Add(label);
        var number = Label(value, 13, "PrimaryTextBrush", true, center: true);
        number.HorizontalAlignment = HorizontalAlignment.Right;
        if (tooltip is not null) ToolTipService.SetToolTip(number, tooltip);
        Grid.SetColumn(number, 1);
        row.Children.Add(number);
        return row;
    }

    private static TextBlock Label(string text, double size, string? brush, bool semibold = false,
        bool bold = false, bool wrap = false, bool center = false)
    {
        var label = new TextBlock
        {
            Text = text,
            FontSize = size,
            Foreground = brush is null ? ResourceBrush("PrimaryTextBrush") : ResourceBrush(brush),
            FontWeight = bold ? Microsoft.UI.Text.FontWeights.Bold :
                semibold ? Microsoft.UI.Text.FontWeights.SemiBold : Microsoft.UI.Text.FontWeights.Normal,
            TextWrapping = wrap ? TextWrapping.Wrap : TextWrapping.NoWrap,
        };
        if (center) label.VerticalAlignment = VerticalAlignment.Center;
        return label;
    }

    private static Windows.UI.Color CapacityColor(double remaining)
    {
        var (red, green, blue) = UsageAnalytics.CapacityColor(remaining);
        return Windows.UI.Color.FromArgb(255, red, green, blue);
    }

    private static string Amount(double? value) => value is { } number
        ? number.ToString("#,##0.##", UiCulture) : "Unavailable";

    private static string Amount(long? value) => value is { } number
        ? number.ToString("#,##0", UiCulture) : "Unavailable";

    private static async Task OpenCommandCodePageAsync(Uri uri)
    {
        try { await Windows.System.Launcher.LaunchUriAsync(uri); }
        catch (Exception error) when (error is System.Runtime.InteropServices.COMException or InvalidOperationException) { }
    }

    private static async Task OpenCommandCodePageAsync(Button button,Uri uri)
    {
        try
        {
            if (!await Windows.System.Launcher.LaunchUriAsync(uri))
                ToolTipService.SetToolTip(button,"Could not open Command Code. Check your default browser.");
        }
        catch (Exception error) when (error is System.Runtime.InteropServices.COMException or InvalidOperationException)
        { ToolTipService.SetToolTip(button,"Could not open Command Code. Check your default browser."); }
    }
}

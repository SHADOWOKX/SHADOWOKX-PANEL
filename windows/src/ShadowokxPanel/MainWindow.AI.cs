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
using ShadowokxPanel.Core.Settings;
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
            content.Children.Add(new Border { Background=ResourceBrush("CardHoverBrush"), CornerRadius=new CornerRadius(6), Padding=new Thickness(4), Child=new Image { Source=id=="weather"?_weatherTabImage:ProviderLogo(id), Width=17,Height=17 } });
            if (pages.Count <= 2)
                content.Children.Add(new TextBlock { Text=id=="codex"?"ChatGPT Codex":id=="weather"?"Weather":AICatalog.Providers[id], FontSize=12, VerticalAlignment=VerticalAlignment.Center });
            var button=new Button { Content=content,CornerRadius=new CornerRadius(10),Height=38,MinWidth=0,Padding=new Thickness(4),HorizontalAlignment=HorizontalAlignment.Stretch,
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
        AIContent.Children.Add(new TextBlock { Text=AICatalog.Providers[SelectedAI]+" Usage",FontSize=16,FontWeight=Microsoft.UI.Text.FontWeights.SemiBold });
        if (SelectedAI == "commandcode" && state.Usage is { Source: "commandcode-api" } nativeUsage)
        {
            RenderCommandCodeNative(state, nativeUsage);
            AIContent.Children.Add(CommandCodeActions());
            return;
        }
        void Card(string title,string value,string? detail=null, double? remaining=null)
        {
            var stack=new StackPanel { Spacing=8 };
            stack.Children.Add(new TextBlock { Text=title,FontSize=12 });
            stack.Children.Add(new TextBlock { Text=value,FontSize=28,Foreground=ResourceBrush("AccentBrush"),TextWrapping=TextWrapping.Wrap });
            if (remaining is { } percentage)
                stack.Children.Add(ProgressMeter(percentage, CapacityColor(percentage)));
            if (detail is not null) stack.Children.Add(new TextBlock { Text=detail,FontSize=12,TextWrapping=TextWrapping.Wrap,Foreground=ResourceBrush("SecondaryTextBrush") });
            AIContent.Children.Add(CardFrame(stack));
        }
        if (state.Usage is { } usage)
        {
            if (SelectedAI == "commandcode")
            {
                AIContent.Children.Add(new TextBlock { Text="Live account consumption: Unavailable",FontSize=12,TextWrapping=TextWrapping.Wrap });
                AIContent.Children.Add(new TextBlock { Text="Configured usage JSON · not an automatic account feed",FontSize=11,TextWrapping=TextWrapping.Wrap });
            }
            foreach (var window in usage.Windows.Where(w=>w.ResetsAt is null || w.ResetsAt>DateTimeOffset.UtcNow))
            {
                var remaining = AllowanceStatus.Remaining(window.UsedPercent);
                Card(window.Label, remaining is { } value ? $"{value:0}% remaining" : "Unavailable",
                    window.ResetsAt is { } reset?FormatCountdown(reset):null, remaining);
            }
            foreach (var balance in usage.Balances) Card("Account balance",$"{balance.Amount:0.##} {balance.Currency}");
            if (usage.Tokens is { } tokens) Card("Tokens",$"{tokens:N0}");
            AIContent.Children.Add(new TextBlock { Text=$"{usage.Account} {usage.Plan} · Updated {usage.UpdatedAt.LocalDateTime:g}{(state.Stale?" · Cached":"")}",FontSize=11,TextWrapping=TextWrapping.Wrap });
        }
        if (state.Error is not null || state.Usage is null)
            Card(SelectedAI == "commandcode" ? "Live account consumption" : "Connection",state.Usage is null ? SelectedAI == "commandcode" ? "Unavailable" : "Connect your account" : "Cached data",state.Error ?? "Choose a usage source in Settings.");
        if (SelectedAI == "commandcode")
        {
            var reference = CommandCodeReference.Goat;
            var stack = new StackPanel { Spacing=6 };
            stack.Children.Add(new TextBlock { Text=reference.Title,FontSize=12,FontWeight=Microsoft.UI.Text.FontWeights.SemiBold });
            foreach (var text in new[] { reference.Price,reference.Limits,reference.Note,reference.Checked })
                stack.Children.Add(new TextBlock { Text=text,FontSize=12,TextWrapping=TextWrapping.Wrap,Foreground=ResourceBrush("SecondaryTextBrush") });
            var docs = new Button { Content="View documented plan limits" };
            docs.Click += async (_,_) => await OpenCommandCodePageAsync(docs,reference.Source);
            stack.Children.Add(docs);
            AIContent.Children.Add(CardFrame(stack));
            var open = new Button { Content="Open CommandCode Usage" };
            open.Click += async (_,_) => await OpenCommandCodePageAsync(open,CommandCodeReference.UsageUri);
            AIContent.Children.Add(open);
        }
        var connect=new Button { Content="Account connection settings" };connect.Click+=(_,_)=>OpenSettings();AIContent.Children.Add(connect);
        var refresh=new Button { Content="Refresh" };refresh.Click+=async (_,_)=>await _host.AI.RefreshAsync();AIContent.Children.Add(refresh);
    }

    // Native live Command Code account view. Weekly allowance is the hero card; the
    // five-hour window is a compact row; real monthly consumption, requests and
    // credit balances use compact account rows. It reuses the shared Codex card,
    // typography, remaining-percentage color scale, status pill and progress meter.
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
        heading.Children.Add(new TextBlock { Text = "Weekly allowance", Style = (Style)Application.Current.Resources["CardTitleStyle"], VerticalAlignment = VerticalAlignment.Center });
        var pill = StatusPill(state, data, percent);
        Grid.SetColumn(pill, 1);
        heading.Children.Add(pill);
        hero.Children.Add(heading);

        if (percent is { } remaining)
        {
            var color = CapacityColor(remaining);
            var valueRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
            var value = new TextBlock { Text = $"{remaining:0}%", FontSize = 34, FontWeight = Microsoft.UI.Text.FontWeights.Bold, Foreground = new SolidColorBrush(color) };
            valueRow.Children.Add(value);
            valueRow.Children.Add(new TextBlock { Text = "remaining", FontSize = 11, Foreground = ResourceBrush("SecondaryTextBrush"), VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, 6) });
            if (weekly is { } window)
                ToolTipService.SetToolTip(valueRow, $"{Amount(window.Used)} / {Amount(window.Cap)} credits consumed · {window.UsedPercent:0.##}% used");
            hero.Children.Add(valueRow);
            hero.Children.Add(ProgressMeter(remaining, color));
        }
        else
        {
            hero.Children.Add(new TextBlock { Text = "Unavailable", FontSize = 20, Foreground = ResourceBrush("SecondaryTextBrush") });
        }

        var rows = new StackPanel { Spacing = 4, Margin = new Thickness(0, 4, 0, 0) };
        rows.Children.Add(new TextBlock { Text = "ACCOUNT USAGE", FontSize = 9, Foreground = ResourceBrush("SecondaryTextBrush") });
        rows.Children.Add(StatRow("Monthly · consumed credits", Amount(consumption?.MonthlyUsedCredits)));
        rows.Children.Add(StatRow("Requests · reported period", Amount(consumption?.Requests)));
        rows.Children.Add(StatRow("Weekly · consumed / limit", weekly is { } week ? $"{Amount(week.Used)} / {Amount(week.Cap)}" : "Unavailable"));
        var period = consumption is { PeriodStart: { } start, PeriodEnd: { } end }
            ? $"{start.LocalDateTime.ToString("MMM d", UiCulture)} – {end.LocalDateTime.ToString("MMM d", UiCulture)}"
            : consumption?.PeriodBasis ?? "Period unavailable";
        var note = new TextBlock { Text = $"Account period · {period}", FontSize = 10, Foreground = ResourceBrush("SecondaryTextBrush"), TextWrapping = TextWrapping.Wrap };
        ToolTipService.SetToolTip(note, $"Reported usage period: {consumption?.PeriodBasis ?? "Unavailable"}. Monthly allowance cap is not reported; no percentage is estimated.");
        rows.Children.Add(note);
        hero.Children.Add(rows);

        var reset = new Grid { Margin = new Thickness(0, 4, 0, 0) };
        reset.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        reset.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        reset.Children.Add(new TextBlock { Text = weekly?.ResetsAt is { } resetAt ? FormatCountdown(resetAt) : "Reset unavailable", FontSize = 12, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis });
        var resetDate = new TextBlock { Text = weekly?.ResetsAt is { } date ? date.LocalDateTime.ToString("ddd h:mm tt", UiCulture) : string.Empty, FontSize = 12, Foreground = ResourceBrush("SecondaryTextBrush"), HorizontalAlignment = HorizontalAlignment.Right };
        Grid.SetColumn(resetDate, 1);
        reset.Children.Add(resetDate);
        hero.Children.Add(reset);
        AIContent.Children.Add(CardFrame(hero));

        var five = new Grid { Padding = new Thickness(16) };
        five.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        five.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var fiveCopy = new StackPanel { Spacing = 2 };
        fiveCopy.Children.Add(new TextBlock { Text = "5-Hour Window", Style = (Style)Application.Current.Resources["CardTitleStyle"] });
        fiveCopy.Children.Add(new TextBlock { Text = fiveHour?.ResetsAt is { } fiveReset ? FormatCountdown(fiveReset) : "Reset unavailable", FontSize = 12, Foreground = ResourceBrush("SecondaryTextBrush") });
        five.Children.Add(fiveCopy);
        var fiveRemaining = fiveHour is null ? null : AllowanceStatus.Remaining(fiveHour.UsedPercent);
        var fiveValue = new TextBlock
        {
            Text = fiveRemaining is { } value ? $"{value:0}% remaining" : "Unavailable",
            FontSize = 15, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center,
            Foreground = fiveRemaining is { } tone ? new SolidColorBrush(CapacityColor(tone)) : ResourceBrush("SecondaryTextBrush"),
        };
        if (fiveHour is { } fiveWindow)
            ToolTipService.SetToolTip(fiveValue, $"{Amount(fiveWindow.Used)} / {Amount(fiveWindow.Cap)} credits consumed · {(fiveWindow.UsedPercent is { } used ? $"{used:0.##}% used" : "Unavailable")}");
        Grid.SetColumn(fiveValue, 1);
        five.Children.Add(fiveValue);
        AIContent.Children.Add(CardFrame(five, "CardBrush"));

        var activity = new StackPanel { Spacing = 5 };
        var activityHeading = new Grid();
        activityHeading.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        activityHeading.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        activityHeading.Children.Add(new TextBlock { Text = "Account activity", Style = (Style)Application.Current.Resources["CardTitleStyle"] });
        var lifetime = new TextBlock { Text = string.IsNullOrEmpty(data.Plan) ? "Unavailable" : data.Plan, FontSize = 11, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Right };
        Grid.SetColumn(lifetime, 1);
        activityHeading.Children.Add(lifetime);
        activity.Children.Add(activityHeading);
        var identity = new TextBlock { Text = string.Join(" · ", new[] { data.PlanStatus, data.Account }.Where(value => !string.IsNullOrEmpty(value))) is { Length: > 0 } text ? text : "Command Code account", FontSize = 11, Foreground = ResourceBrush("SecondaryTextBrush"), TextWrapping = TextWrapping.Wrap };
        ToolTipService.SetToolTip(identity, "Read-only Command Code API · Refreshes every 3 minutes");
        activity.Children.Add(identity);
        activity.Children.Add(StatRow("Total consumed · credits", Amount(consumption?.UsedCredits)));
        foreach (var balance in data.CreditBalances) activity.Children.Add(StatRow(balance.Label, Amount(balance.Amount)));
        if (consumption?.PeriodEnd is { } periodEnd)
            activity.Children.Add(StatRow("Billing period ends", periodEnd.LocalDateTime.ToString("MMM d", UiCulture)));
        AIContent.Children.Add(CardFrame(activity, "CardBrush"));

        var footer = new Grid();
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var age = DateTimeOffset.Now - data.UpdatedAt;
        var relative = age.TotalSeconds < 5 ? "just now" : age.TotalMinutes < 60 ? $"{Math.Max(1, (int)age.TotalMinutes)}m ago" : $"{(int)age.TotalHours}h ago";
        var refresh = new TextBlock { Text = $"{(state.Stale ? "Cached" : "Usage checked")} {relative}", FontSize = 11, Foreground = ResourceBrush("SecondaryTextBrush"), HorizontalAlignment = HorizontalAlignment.Right };
        var tooltip = $"Last successful refresh: {data.UpdatedAt.LocalDateTime:g}{(state.Error is null ? string.Empty : $"\n{state.Error}")}{(data.RetryAt is { } retry && retry > DateTimeOffset.Now ? $"\nRetry after {retry.LocalDateTime:t}" : string.Empty)}";
        ToolTipService.SetToolTip(refresh, tooltip);
        Grid.SetColumn(refresh, 1);
        footer.Children.Add(refresh);
        AIContent.Children.Add(footer);
    }

    private UIElement CommandCodeActions()
    {
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        var open = new Button { Content = "Open CommandCode Usage" };
        open.Click += async (_, _) => await OpenCommandCodePageAsync(open, CommandCodeReference.UsageUri);
        actions.Children.Add(open);
        var refresh = new Button { Content = "Refresh", IsEnabled = true };
        refresh.Click += async (_, _) =>
        {
            refresh.IsEnabled = false;
            try { await _host.AI.RefreshAsync(); }
            catch (OperationCanceledException) { }
            finally { if (!_disposed) refresh.IsEnabled = true; }
        };
        actions.Children.Add(refresh);
        var settings = new Button { Content = "Command Code settings" };
        settings.Click += (_, _) => OpenSettings();
        actions.Children.Add(settings);
        AutomationProperties.SetName(actions, "Command Code actions");
        return actions;
    }

    private Border StatusPill(AIState state, AIUsage data, double? percent)
    {
        var text = state.Stale ? "Stale" : data.Warnings.Count > 0 ? "Partial"
            : percent is null ? "Unavailable" : UsageAnalytics.CapacityLabel(percent);
        var tone = state.Stale || percent is null ? ResourceBrush("SecondaryTextBrush").Color : CapacityColor(percent.Value);
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 5 };
        content.Children.Add(new Ellipse { Width = 6, Height = 6, Fill = new SolidColorBrush(tone), VerticalAlignment = VerticalAlignment.Center });
        content.Children.Add(new TextBlock { Text = text, FontSize = 11, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center });
        var pill = new Border { Background = ResourceBrush("CardHoverBrush"), CornerRadius = new CornerRadius(9), Padding = new Thickness(9, 4, 9, 4), VerticalAlignment = VerticalAlignment.Center, Child = content };
        ToolTipService.SetToolTip(pill, state.Error ?? (data.Warnings.Count > 0 ? "Some account metrics were not returned." : "Live Command Code account usage"));
        return pill;
    }

    // Text and fill derive from the same canonical remaining percentage, so the
    // visible fill always matches the displayed value.
    private Grid ProgressMeter(double remaining, Windows.UI.Color color)
    {
        var track = new Grid { Height = 9, Background = ResourceBrush("TrackBrush"), CornerRadius = new CornerRadius(5), Margin = new Thickness(0, 2, 0, 2) };
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(remaining, GridUnitType.Star) });
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(100 - remaining, GridUnitType.Star) });
        var fill = new Border { Background = new SolidColorBrush(color), CornerRadius = new CornerRadius(5) };
        Grid.SetColumn(fill, 0);
        track.Children.Add(fill);
        AutomationProperties.SetName(track, $"{remaining:0.#}% remaining");
        return track;
    }

    private Border CardFrame(UIElement child, string background = "CardBrush") => new()
    {
        Child = child, Padding = new Thickness(16), CornerRadius = new CornerRadius(16),
        Background = ResourceBrush(background), BorderBrush = ResourceBrush("CardBorderBrush"),
        BorderThickness = new Thickness(1),
    };

    private Grid StatRow(string title, string value, string? tooltip = null)
    {
        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.Children.Add(new TextBlock { Text = title, FontSize = 12, Foreground = ResourceBrush("SecondaryTextBrush"), VerticalAlignment = VerticalAlignment.Center });
        var number = new TextBlock { Text = value, FontSize = 12, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
        if (tooltip is not null) ToolTipService.SetToolTip(number, tooltip);
        Grid.SetColumn(number, 1);
        row.Children.Add(number);
        return row;
    }

    private Windows.UI.Color CapacityColor(double remaining)
    {
        var (red, green, blue) = UsageAnalytics.CapacityColor(remaining);
        return Windows.UI.Color.FromArgb(255, red, green, blue);
    }

    private static string Amount(double? value) => value is { } number
        ? number.ToString("#,##0.##", UiCulture) : "Unavailable";

    private static string Amount(long? value) => value is { } number
        ? number.ToString("#,##0", UiCulture) : "Unavailable";

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

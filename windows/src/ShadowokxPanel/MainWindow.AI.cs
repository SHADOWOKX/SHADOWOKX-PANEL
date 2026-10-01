using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Media.Imaging;
using ShadowokxPanel.Core.AI;
using ShadowokxPanel.Core.Settings;
namespace ShadowokxPanel;
public sealed partial class MainWindow
{
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
        void Card(string title,string value,string? detail=null)
        {
            var stack=new StackPanel { Spacing=8 };
            stack.Children.Add(new TextBlock { Text=title,FontSize=12 });
            stack.Children.Add(new TextBlock { Text=value,FontSize=28,Foreground=ResourceBrush("AccentBrush"),TextWrapping=TextWrapping.Wrap });
            if (detail is not null) stack.Children.Add(new TextBlock { Text=detail,FontSize=12,TextWrapping=TextWrapping.Wrap,Foreground=ResourceBrush("SecondaryTextBrush") });
            AIContent.Children.Add(new Border { Child=stack,Padding=new Thickness(16),CornerRadius=new CornerRadius(16),Background=ResourceBrush("CardBrush"),BorderBrush=ResourceBrush("CardBorderBrush"),BorderThickness=new Thickness(1) });
        }
        if (state.Usage is { } usage)
        {
            foreach (var window in usage.Windows.Where(w=>w.ResetsAt is null || w.ResetsAt>DateTimeOffset.UtcNow))
                Card(window.Label,$"{100-window.UsedPercent:0.#}% remaining",window.ResetsAt is { } reset?FormatCountdown(reset):null);
            foreach (var balance in usage.Balances) Card("Account balance",$"{balance.Amount:0.##} {balance.Currency}");
            if (usage.Tokens is { } tokens) Card("Tokens",$"{tokens:N0}");
            AIContent.Children.Add(new TextBlock { Text=$"{usage.Account} {usage.Plan} · Updated {usage.UpdatedAt.LocalDateTime:g}{(state.Stale?" · Cached":"")}",FontSize=11,TextWrapping=TextWrapping.Wrap });
        }
        if (state.Error is not null || state.Usage is null)
            Card("Connection",state.Usage is null?"Connect your account":"Cached data",state.Error ?? "Choose a usage source in Settings.");
        var connect=new Button { Content="Account connection settings" };connect.Click+=(_,_)=>OpenSettings();AIContent.Children.Add(connect);
        var refresh=new Button { Content="Refresh" };refresh.Click+=async (_,_)=>await _host.AI.RefreshAsync();AIContent.Children.Add(refresh);
    }
}

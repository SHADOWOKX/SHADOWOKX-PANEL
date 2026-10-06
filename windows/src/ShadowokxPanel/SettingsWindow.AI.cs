using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using ShadowokxPanel.Core.AI;
using ShadowokxPanel.Core.Presentation;
using System.Net.Http;
using System.Text.Json.Nodes;
using Windows.Storage.Pickers;
namespace ShadowokxPanel;
public sealed partial class SettingsWindow
{
    private void RenderProviderSettings()
    {
        ProviderSettings.Children.Clear();
        foreach (var (id,name) in AICatalog.Providers)
        {
            var row=new StackPanel { Spacing=6 };
            var removed=_host.Settings.Current.RemovedProviders.Contains(id);
            row.Children.Add(new TextBlock { Text=name,FontWeight=Microsoft.UI.Text.FontWeights.SemiBold });
            if (id == "commandcode")
                row.Children.Add(new TextBlock { Text="Add your Command Code API key to read live account usage with direct read-only requests every 3 minutes. The key is validated, then stored only in Windows Credential Manager; it is never written to settings, JSON or logs. " + CommandCodeStatus.Limitation,
                    TextWrapping=TextWrapping.Wrap,FontSize=12 });
            var visible=new CheckBox { Content="Show in panel",IsChecked=_host.Settings.Current.VisibleProviders.Contains(id) && !removed,IsEnabled=!removed };
            visible.Click+=async (_,_)=>
            {
                var ids=_host.Settings.Current.VisibleProviders.Where(p=>p!=id).ToList();if (visible.IsChecked==true) ids.Add(id);
                await SaveProviderAsync(_host.Settings.Current with { VisibleProviders=ids.ToArray() });
            };
            row.Children.Add(visible);
            var actions=new StackPanel { Orientation=Orientation.Horizontal,Spacing=5 };
            if (id!="codex" && !removed)
            {
                if (id == "commandcode") AddCommandCodeActions(row, actions);
                var choose=new Button { Content="Usage file" };choose.Click+=async (_,_)=>await ChooseSourceAsync(id,false);actions.Children.Add(choose);
                if (id=="claude") { var connect=new Button { Content="Connect Claude" };connect.Click+=async (_,_)=>await ConnectClaudeAsync();actions.Children.Add(connect); }
                if (id=="deepseek") { var connect=new Button { Content="API key" };connect.Click+=async (_,_)=>await ConnectDeepSeekAsync();actions.Children.Add(connect); }
                if (id != "commandcode")
                {
                    var disconnect=new Button { Content="Disconnect" };disconnect.Click+=async (_,_)=>
                    {
                        var sources=new Dictionary<string,AISource>(_host.Settings.Current.AISources);
                        sources[id]=new(Path.Combine(_host.Paths.Root,"disconnected",id+".json"));
                        await SaveProviderAsync(_host.Settings.Current with { AISources=sources });
                    };actions.Children.Add(disconnect);
                }
            }
            var remove=new Button { Content=removed?"Add back":"Remove" };remove.Click+=async (_,_)=>
            {
                var settings=_host.Settings.Current;
                var deleted=settings.RemovedProviders.Where(p=>p!=id).ToList();var shown=settings.VisibleProviders.Where(p=>p!=id).ToList();
                if (removed) shown.Add(id);else deleted.Add(id);
                await SaveProviderAsync(settings with { RemovedProviders=deleted.ToArray(),VisibleProviders=shown.ToArray() });RenderProviderSettings();
            };actions.Children.Add(remove);row.Children.Add(actions);
            ProviderSettings.Children.Add(row);
        }
    }

    private void AddCommandCodeActions(StackPanel row, StackPanel actions)
    {
        var keyBox = new PasswordBox { Header = "Command Code API key", PlaceholderText = "Paste your key", MaxLength = 4096 };
        row.Children.Add(keyBox);
        var apply = new Button { Content = "Apply key" };
        var check = new Button { Content = "Check connection" };
        var forget = new Button { Content = "Forget key" };
        void Busy(bool value) { apply.IsEnabled = check.IsEnabled = forget.IsEnabled = !value; keyBox.IsEnabled = !value; }
        apply.Click += async (_, _) =>
        {
            var token = keyBox.Password.Trim();
            keyBox.Password = string.Empty;
            if (token.Length == 0)
            {
                ConnectionMessage.Text = "Enter your Command Code API key.";
                return;
            }
            Busy(true);
            ConnectionMessage.Text = "Verifying Command Code account usage…";
            try
            {
                var usage = await _host.AI.ConnectCommandCodeAsync(token);
                ConnectionMessage.Text = "Command Code connected securely. " + Describe(usage);
            }
            catch (Exception error) when (error is CommandCodeException or IOException or UnauthorizedAccessException or HttpRequestException or OperationCanceledException)
            {
                ConnectionMessage.Text = error.Message;
            }
            finally
            {
                token = string.Empty;
                Busy(false);
                RenderProviderSettings();
            }
        };
        check.Click += async (_, _) =>
        {
            Busy(true);
            try
            {
                var usage = await _host.AI.CheckCommandCodeAsync();
                ConnectionMessage.Text = Describe(usage);
                await _host.AI.RefreshAsync();
            }
            catch (Exception error) when (error is CommandCodeException or IOException or UnauthorizedAccessException or HttpRequestException or OperationCanceledException)
            {
                ConnectionMessage.Text = error.Message;
            }
            finally
            {
                Busy(false);
            }
        };
        forget.Click += async (_, _) =>
        {
            Busy(true);
            try
            {
                await _host.AI.DisconnectCommandCodeAsync();
                ConnectionMessage.Text = "Command Code API key removed from Windows Credential Manager.";
            }
            catch (Exception error) when (error is CommandCodeException or IOException or UnauthorizedAccessException or OperationCanceledException)
            {
                ConnectionMessage.Text = error.Message;
            }
            finally
            {
                Busy(false);
                RenderProviderSettings();
            }
        };
        actions.Children.Add(apply);
        actions.Children.Add(check);
        actions.Children.Add(forget);

        var checkLogin = new Button { Content = "Check login" };
        checkLogin.Click += async (_, _) =>
        {
            checkLogin.IsEnabled = false;
            ConnectionMessage.Text = CommandCodeStatus.Message(await CommandCodeStatus.ReadAsync());
            checkLogin.IsEnabled = true;
        };
        row.Children.Add(checkLogin);
        var openUsage = new Button { Content = "Open CommandCode Usage" };
        openUsage.Click += async (_, _) =>
        {
            try
            {
                if (!await Windows.System.Launcher.LaunchUriAsync(CommandCodeReference.UsageUri))
                    ConnectionMessage.Text = "Could not open usage. Check your default browser.";
            }
            catch (Exception error) when (error is System.Runtime.InteropServices.COMException or InvalidOperationException)
            {
                ConnectionMessage.Text = "Could not open usage. Check your default browser.";
            }
        };
        row.Children.Add(openUsage);
        var reference = CommandCodeReference.Goat;
        row.Children.Add(new TextBlock { Text=$"{reference.Title}: {reference.Price}. {reference.Limits}. {reference.Note} {reference.Checked}.",
            TextWrapping=TextWrapping.Wrap,FontSize=12 });
    }

    private static string Describe(AIUsage usage)
    {
        var window = usage.Windows.FirstOrDefault(w => w.Label == "Weekly allowance") ?? usage.Windows.FirstOrDefault();
        var remaining = window is null ? null : AllowanceStatus.Remaining(window.UsedPercent);
        return remaining is { } value
            ? $"{usage.Plan ?? "Plan unavailable"} · {value:0}% weekly remaining."
            : $"{usage.Plan ?? "Plan unavailable"} · Account usage received.";
    }

    private async Task SaveProviderAsync(Core.Settings.AppSettings settings)
    {
        try { await _host.Settings.SaveAsync(settings);ConnectionMessage.Text="Saved. Usage updates appear automatically."; }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { ConnectionMessage.Text="Could not save account settings."; }
    }
    private async Task SetSourceAsync(string id,AISource source)
    {
        // Choosing a usage JSON file switches Command Code to its labeled advanced JSON
        // mode; reconnecting the secure API switches it back without deleting the file.
        if (id == "commandcode" && source.Path.Length > 0) source = source with { Mode = "json" };
        var settings=_host.Settings.Current;var sources=new Dictionary<string,AISource>(settings.AISources) { [id]=source };
        await SaveProviderAsync(settings with { AISources=sources,VisibleProviders=settings.VisibleProviders.Append(id).Distinct().ToArray(),RemovedProviders=settings.RemovedProviders.Where(p=>p!=id).ToArray() });
        RenderProviderSettings();await _host.AI.RefreshAsync();
    }
    private async Task ChooseSourceAsync(string id,bool key)
    {
        var picker=new FileOpenPicker();picker.FileTypeFilter.Add(key?"*":".json");
        WinRT.Interop.InitializeWithWindow.Initialize(picker,WinRT.Interop.WindowNative.GetWindowHandle(this));
        var file=await picker.PickSingleFileAsync();if (file is null) return;
        await SetSourceAsync(id,key?new(KeyFile:file.Path):new(file.Path));
    }
    private async Task ConnectDeepSeekAsync()
    {
        var box=new PasswordBox { Header="DeepSeek API key" };
        var dialog=new ContentDialog { XamlRoot=Root.XamlRoot,Title="Connect DeepSeek",Content=box,PrimaryButtonText="Connect",CloseButtonText="Cancel" };
        if (await dialog.ShowAsync()!=ContentDialogResult.Primary) return;
        var key=box.Password.Trim();box.Password="";
        if (key.Length==0 || key.Length>4096 || key.Any(char.IsWhiteSpace)) { ConnectionMessage.Text="Enter a valid API key.";return; }
        try
        {
            var path=Path.Combine(_host.Paths.Root,"secrets","deepseek.key");Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await File.WriteAllTextAsync(path,key);
            await SetSourceAsync("deepseek",new(KeyFile:path));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { ConnectionMessage.Text="Could not save the API key."; }
    }
    private async Task ConnectClaudeAsync()
    {
        try
        {
            var config=Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR");
            if (string.IsNullOrWhiteSpace(config)) config=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".claude");
            Directory.CreateDirectory(config);
            var path=Path.Combine(config,"settings.json");
            var settings=File.Exists(path)?JsonNode.Parse(await File.ReadAllTextAsync(path))?.AsObject() ?? new():new JsonObject();
            var old=settings["statusLine"]?["command"]?.GetValue<string>();
            var script=Path.Combine(AppContext.BaseDirectory,"Assets","Connections","claude-statusline.ps1");
            var destination=_host.AI.DefaultPath("claude");
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            var previous=Path.Combine(_host.Paths.Root,"usage","claude-previous-command.txt");
            if (!string.IsNullOrWhiteSpace(old) && !old.Contains("claude-statusline.ps1",StringComparison.Ordinal)) await File.WriteAllTextAsync(previous,old);
            static string Quote(string text)=>"'"+text.Replace("'","''",StringComparison.Ordinal)+"'";
            var command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command " + (char)34 + "& " + Quote(script) + " -OutputPath " + Quote(destination) + " -PreviousFile " + Quote(previous) + (char)34;
            settings["statusLine"]=new JsonObject { ["type"]="command",["command"]=command };
            if (File.Exists(path)) File.Copy(path,path+".shadow-panel-backup",true);
            await File.WriteAllTextAsync(path,settings.ToJsonString(new() { WriteIndented=true }));
            await SetSourceAsync("claude",new(destination));
            ConnectionMessage.Text="Connected. Restart Claude Code; usage appears when Claude reports its limits. Previous status line is preserved.";
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Text.Json.JsonException or InvalidOperationException)
        { ConnectionMessage.Text="Could not connect Claude. You can choose a usage JSON file instead."; }
    }
}

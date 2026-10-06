using System.Drawing;
using System.Windows.Automation;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using WpfShell.Core;
using Forms = System.Windows.Forms;

namespace WpfShell;

public partial class MainWindow : Window
{
    private readonly Forms.NotifyIcon _trayIcon;
    private string _draft = string.Empty;
    private string? _preferredScreen;
    private DockEdge _selectedEdge = DockEdge.Top;
    private bool _syncingControls;
    private bool _allowClose;
    private int _imeCompositionStartCount;
    private int _imeCompositionUpdateCount;
    private int _imeTextInputCount;

    public MainWindow()
    {
        InitializeComponent();
        TextCompositionManager.AddPreviewTextInputStartHandler(DraftInput, OnImeCompositionStart);
        TextCompositionManager.AddPreviewTextInputUpdateHandler(DraftInput, OnImeCompositionUpdate);
        TextCompositionManager.AddPreviewTextInputHandler(DraftInput, OnImeTextInput);
        UpdateImeAutomationStatus();
        _trayIcon = CreateTrayIcon();
        Loaded += OnLoaded;
        Closing += OnClosing;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        RefreshScreens();
        ApplyDockPosition();
    }

    private Forms.NotifyIcon CreateTrayIcon()
    {
        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("Show summary", null, (_, _) => ShowSummary());
        menu.Items.Add("Hide summary", null, (_, _) => Hide());
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitFromTray());

        var icon = new Forms.NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "Widget Platform G1-D",
            ContextMenuStrip = menu,
            Visible = true
        };
        icon.MouseClick += (_, args) =>
        {
            if (args.Button == Forms.MouseButtons.Left)
            {
                if (IsVisible) Hide();
                else ShowSummary();
            }
        };
        return icon;
    }

    private void RefreshScreens()
    {
        var screens = Forms.Screen.AllScreens;
        _syncingControls = true;
        DisplayBox.Items.Clear();
        foreach (var screen in screens)
        {
            DisplayBox.Items.Add(new ScreenChoice(screen));
        }

        var active = screens.FirstOrDefault(screen => screen.DeviceName == _preferredScreen)
            ?? Forms.Screen.FromHandle(new WindowInteropHelper(this).Handle);
        if (active is not null)
        {
            _preferredScreen = active.DeviceName;
            DisplayBox.SelectedItem = DisplayBox.Items.Cast<ScreenChoice>()
                .FirstOrDefault(choice => choice.Screen.DeviceName == _preferredScreen);
        }
        _syncingControls = false;
    }

    private void OnDisplayChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_syncingControls || DisplayBox.SelectedItem is not ScreenChoice selected) return;
        _preferredScreen = selected.Screen.DeviceName;
        ApplyDockPosition();
        Dispatcher.BeginInvoke(DispatcherPriority.ContextIdle, new Action(() =>
        {
            if (string.Equals(_preferredScreen, selected.Screen.DeviceName, StringComparison.OrdinalIgnoreCase))
            {
                ApplyDockPosition();
            }
        }));
    }

    private void OnTogglePanel(object sender, RoutedEventArgs e)
    {
        if (InputPanel.Visibility == Visibility.Visible)
        {
            CloseInputPanel();
            return;
        }

        InputPanel.Visibility = Visibility.Visible;
        OpenPanelButton.Content = "Hide";
        Width = 360;
        Height = 350;
        ShowActivated = true;
        ApplyDockPosition();
        Show();
        Activate();
        Dispatcher.BeginInvoke(DispatcherPriority.Input, new Action(() => DraftInput.Focus()));
    }

    private void OnClosePanel(object sender, RoutedEventArgs e) => CloseInputPanel();

    private void CloseInputPanel()
    {
        InputPanel.Visibility = Visibility.Collapsed;
        OpenPanelButton.Content = "Open";
        Width = 292;
        Height = 72;
        ApplyDockPosition();
        OpenPanelButton.Focus();
    }

    private void OnWindowKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Escape && InputPanel.Visibility == Visibility.Visible)
        {
            CloseInputPanel();
            e.Handled = true;
        }
    }

    private void OnDraftChanged(object sender, TextChangedEventArgs e)
    {
        if (!_syncingControls) _draft = DraftInput.Text;
    }

    private void OnImeCompositionStart(object sender, TextCompositionEventArgs e)
    {
        _imeCompositionStartCount++;
        UpdateImeAutomationStatus();
    }

    private void OnImeCompositionUpdate(object sender, TextCompositionEventArgs e)
    {
        _imeCompositionUpdateCount++;
        UpdateImeAutomationStatus();
    }

    private void OnImeTextInput(object sender, TextCompositionEventArgs e)
    {
        _imeTextInputCount++;
        UpdateImeAutomationStatus();
    }

    private void UpdateImeAutomationStatus() => AutomationProperties.SetHelpText(
        DraftInput,
        $"Composition starts: {_imeCompositionStartCount}; updates: {_imeCompositionUpdateCount}; text input events: {_imeTextInputCount}");

    private void OnRatioChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (!_syncingControls && IsLoaded)
        {
            RatioLabel.Text = $"{(int)Math.Round(RatioSlider.Value)}%";
            ApplyDockPosition();
        }
    }

    private void OnEdgeSelected(object sender, RoutedEventArgs e)
    {
        if (sender is not System.Windows.Controls.Button { Tag: string tag }) return;
        if (!Enum.TryParse(tag, ignoreCase: true, out DockEdge edge)) return;
        _selectedEdge = edge;
        ApplyDockPosition();
    }

    private void ApplyDockPosition()
    {
        if (!IsLoaded) return;
        var screen = Forms.Screen.AllScreens.FirstOrDefault(item => item.DeviceName == _preferredScreen)
            ?? Forms.Screen.FromHandle(new WindowInteropHelper(this).Handle);
        var dpi = VisualTreeHelper.GetDpi(this);
        var workArea = DockGeometry.ToDips(
            new DockRect(screen.WorkingArea.Left, screen.WorkingArea.Top,
                screen.WorkingArea.Width, screen.WorkingArea.Height), dpi.DpiScaleX, dpi.DpiScaleY);
        var placement = DockGeometry.Compute(workArea,
            new DockSize(Width, Height), _selectedEdge, RatioSlider.Value / 100d);
        Left = placement.X;
        Top = placement.Y;
    }

    private void ShowSummary()
    {
        if (InputPanel.Visibility == Visibility.Visible) CloseInputPanel();
        Show();
        Activate();
    }

    private void ExitFromTray()
    {
        _allowClose = true;
        _trayIcon.Visible = false;
        Close();
        System.Windows.Application.Current.Shutdown();
    }

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        if (!_allowClose)
        {
            e.Cancel = true;
            Hide();
        }
    }

    protected override void OnClosed(EventArgs e)
    {
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
        base.OnClosed(e);
    }

    private sealed record ScreenChoice(Forms.Screen Screen)
    {
        public override string ToString() =>
            $"{Screen.DeviceName} · {Screen.WorkingArea.Width}×{Screen.WorkingArea.Height}";
    }
}

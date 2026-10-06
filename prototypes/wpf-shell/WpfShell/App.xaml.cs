using System.Threading;
using System.Windows;
using Application = System.Windows.Application;

namespace WpfShell;

/// <summary>
/// Interaction logic for App.xaml
/// </summary>
public partial class App : Application
{
    private Mutex? _singleInstanceMutex;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        _singleInstanceMutex = new Mutex(initiallyOwned: true, "Local\\WidgetPlatform.G1D.WpfShell", out var createdNew);
        if (!createdNew)
        {
            Shutdown();
            return;
        }

        MainWindow = new MainWindow();
        MainWindow.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        if (_singleInstanceMutex is not null)
        {
            try { _singleInstanceMutex.ReleaseMutex(); }
            catch (ApplicationException) { }
            _singleInstanceMutex.Dispose();
        }

        base.OnExit(e);
    }
}


use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Runtime, WindowEvent};

mod features;
mod host;
mod storage;

const SHOW_MENU_ID: &str = "show-main-window";
const EXIT_MENU_ID: &str = "exit-application";

#[derive(Debug, PartialEq, Eq)]
enum TrayAction {
    ShowMainWindow,
    ExitApplication,
    Ignore,
}

fn tray_action(menu_id: &str) -> TrayAction {
    match menu_id {
        SHOW_MENU_ID => TrayAction::ShowMainWindow,
        EXIT_MENU_ID => TrayAction::ExitApplication,
        _ => TrayAction::Ignore,
    }
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    let builder =
        tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }));

    #[cfg(any(debug_assertions, feature = "g2c-probe"))]
    let builder = builder.manage(host::counter_probe::CounterProbe::new());

    let builder = builder
        .setup(|app| {
            let instance_id = format!(
                "{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            );
            let todo_state = match app.path().app_local_data_dir() {
                Ok(directory) => features::todo::TodoState::open(
                    directory.join("todo.sqlite3"),
                    instance_id.clone(),
                ),
                Err(_) => features::todo::TodoState::unavailable(
                    features::todo::TodoError::data_directory_unavailable(),
                ),
            };
            app.manage(todo_state);
            let timer_state = match app.path().app_local_data_dir() {
                Ok(directory) => features::timer::TimerState::open(
                    directory.join("timer.sqlite3"),
                    instance_id.clone(),
                ),
                Err(_) => features::timer::TimerState::unavailable(
                    features::timer::TimerError::data_directory_unavailable(),
                ),
            };
            app.manage(timer_state);
            app.manage(features::metrics::MetricsState::new());
            app.manage(features::codex::CodexRuntime::new());
            app.manage(features::media::MediaRuntime::default());
            let weather_runtime = app
                .path()
                .app_local_data_dir()
                .map(|directory| {
                    features::weather::WeatherRuntime::new(directory.join("weather-cache.json"))
                })
                .unwrap_or_else(|_| features::weather::WeatherRuntime::memory_only());
            app.manage(weather_runtime);

            #[cfg(target_os = "windows")]
            let clipboard_state = match app.path().app_local_data_dir() {
                Ok(directory) => features::clipboard::ClipboardRuntime::open(
                    directory.join("clipboard.sqlite3"),
                    std::sync::Arc::new(features::clipboard::WindowsDpapiProtector),
                    std::sync::Arc::new(features::clipboard::WindowsClipboardBackend::default()),
                    features::clipboard::ClipboardPolicy::default(),
                )
                .map(features::clipboard::ClipboardState::available)
                .unwrap_or_else(|error| {
                    features::clipboard::ClipboardState::unavailable(
                        features::clipboard::ClipboardCommandError::Runtime(error),
                    )
                }),
                Err(_) => features::clipboard::ClipboardState::unavailable(
                    features::clipboard::ClipboardCommandError::Unavailable,
                ),
            };
            #[cfg(target_os = "windows")]
            app.manage(clipboard_state);

            let show_item = MenuItem::with_id(app, SHOW_MENU_ID, "显示主窗口", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let exit_item = MenuItem::with_id(
                app,
                EXIT_MENU_ID,
                "退出 Widget Platform",
                true,
                None::<&str>,
            )?;
            let menu = Menu::with_items(app, &[&show_item, &separator, &exit_item])?;
            let icon = app
                .default_window_icon()
                .cloned()
                .expect("the product window icon must be configured");

            TrayIconBuilder::with_id("widget-platform")
                .icon(icon)
                .tooltip("Widget Platform")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match tray_action(event.id().as_ref()) {
                    TrayAction::ShowMainWindow => show_main_window(app),
                    TrayAction::ExitApplication => app.exit(0),
                    TrayAction::Ignore => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            } else if window.label() == "settings" {
                if let WindowEvent::CloseRequested { .. } = event {
                    let _ = window.destroy();
                }
            }
        });

    #[cfg(any(debug_assertions, feature = "g2c-probe"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        host::settings::settings_load,
        host::settings::settings_save,
        host::native_drag::native_left_button_is_down,
        features::todo::commands::todo_get_snapshot,
        features::todo::commands::todo_add,
        features::todo::commands::todo_set_completed,
        features::todo::commands::todo_delete,
        features::todo::commands::todo_reorder,
        features::timer::commands::timer_get_snapshot,
        features::timer::commands::timer_start,
        features::timer::commands::timer_pause,
        features::timer::commands::timer_resume,
        features::timer::commands::timer_reset,
        features::timer::commands::timer_expire,
        features::metrics::commands::metrics_sample,
        features::media::commands::media_subscribe,
        features::media::commands::media_get_snapshot,
        features::media::commands::media_unsubscribe,
        features::media::commands::media_get_artwork,
        features::media::commands::media_control,
        features::codex::commands::codex_quota_read,
        features::codex::commands::codex_quota_cancel,
        features::weather::commands::weather_read,
        features::weather::commands::weather_cancel,
        features::clipboard::commands::clipboard_get_snapshot,
        features::clipboard::commands::clipboard_set_enabled,
        features::clipboard::commands::clipboard_set_pinned,
        features::clipboard::commands::clipboard_delete,
        features::clipboard::commands::clipboard_clear,
        features::clipboard::commands::clipboard_restore,
        host::counter_probe::counter_probe_snapshot,
        features::weather::commands::weather_search_cities,
        features::weather::commands::weather_locate,
        host::counter_probe::counter_probe_enable,
        host::counter_probe::counter_probe_disable
    ]);

    #[cfg(not(any(debug_assertions, feature = "g2c-probe")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        host::settings::settings_load,
        host::settings::settings_save,
        host::native_drag::native_left_button_is_down,
        features::todo::commands::todo_get_snapshot,
        features::todo::commands::todo_add,
        features::todo::commands::todo_set_completed,
        features::todo::commands::todo_delete,
        features::todo::commands::todo_reorder,
        features::timer::commands::timer_get_snapshot,
        features::timer::commands::timer_start,
        features::timer::commands::timer_pause,
        features::timer::commands::timer_resume,
        features::timer::commands::timer_reset,
        features::timer::commands::timer_expire,
        features::metrics::commands::metrics_sample,
        features::media::commands::media_subscribe,
        features::media::commands::media_get_snapshot,
        features::media::commands::media_unsubscribe,
        features::media::commands::media_get_artwork,
        features::media::commands::media_control,
        features::codex::commands::codex_quota_read,
        features::codex::commands::codex_quota_cancel,
        features::weather::commands::weather_read,
        features::weather::commands::weather_cancel,
        features::clipboard::commands::clipboard_get_snapshot,
        features::clipboard::commands::clipboard_set_enabled,
        features::clipboard::commands::clipboard_set_pinned,
        features::clipboard::commands::clipboard_delete,
        features::clipboard::commands::clipboard_clear,
        features::clipboard::commands::clipboard_restore,
        features::weather::commands::weather_search_cities,
        features::weather::commands::weather_locate
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("failed to run Widget Platform");
}

#[cfg(test)]
mod tests {
    use super::{tray_action, TrayAction, EXIT_MENU_ID, SHOW_MENU_ID};

    #[test]
    fn tray_menu_has_explicit_show_and_exit_actions() {
        assert_eq!(tray_action(SHOW_MENU_ID), TrayAction::ShowMainWindow);
        assert_eq!(tray_action(EXIT_MENU_ID), TrayAction::ExitApplication);
    }

    #[test]
    fn unknown_tray_action_is_ignored() {
        assert_eq!(tray_action("unknown"), TrayAction::Ignore);
    }
}

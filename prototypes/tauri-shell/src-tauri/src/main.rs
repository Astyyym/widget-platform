#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WindowEvent,
};

#[derive(Debug, PartialEq, Eq)]
enum TrayAction {
    Show,
    Exit,
    Ignore,
}

fn tray_action_for_menu_item(id: &str) -> TrayAction {
    match id {
        "show" => TrayAction::Show,
        "exit" => TrayAction::Exit,
        _ => TrayAction::Ignore,
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn tray_image() -> Image<'static> {
    let mut pixels = Vec::with_capacity(16 * 16 * 4);
    for y in 0..16 {
        for x in 0..16 {
            let inside = (2..14).contains(&x) && (2..14).contains(&y);
            pixels.extend_from_slice(if inside {
                &[121, 83, 204, 255]
            } else {
                &[0, 0, 0, 0]
            });
        }
    }
    Image::new_owned(pixels, 16, 16)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Show summary", true, None::<&str>)?;
            let exit_item = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &exit_item])?;

            TrayIconBuilder::new()
                .icon(tray_image())
                .tooltip("Widget Platform G1-B")
                .menu(&menu)
                .on_menu_event(
                    |app, event| match tray_action_for_menu_item(event.id().as_ref()) {
                        TrayAction::Show => show_main_window(app),
                        TrayAction::Exit => app.exit(0),
                        TrayAction::Ignore => {}
                    },
                )
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run the G1-B Tauri shell");
}

#[cfg(test)]
mod tests {
    use super::{tray_action_for_menu_item, TrayAction};

    #[test]
    fn tray_exit_item_routes_to_explicit_exit_action() {
        assert_eq!(tray_action_for_menu_item("exit"), TrayAction::Exit);
        assert_eq!(tray_action_for_menu_item("show"), TrayAction::Show);
        assert_eq!(tray_action_for_menu_item("unknown"), TrayAction::Ignore);
    }
}

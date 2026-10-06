#[cfg(windows)]
pub fn left_button_is_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    unsafe { ((GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16) & 0x8000) != 0 }
}

#[cfg(not(windows))]
pub fn left_button_is_down() -> bool {
    false
}

#[tauri::command]
pub fn native_left_button_is_down() -> bool {
    left_button_is_down()
}

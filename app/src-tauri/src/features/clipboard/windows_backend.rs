use super::{ClipboardBackend, ClipboardBackendError, ClipboardObserver, ObservedClipboardText};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{
    GlobalFree, HANDLE, HGLOBAL, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM,
};
use windows::Win32::System::DataExchange::{
    AddClipboardFormatListener, CloseClipboard, EmptyClipboard, GetClipboardData,
    GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard,
    RegisterClipboardFormatW, RemoveClipboardFormatListener, SetClipboardData,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, PostMessageW,
    RegisterClassW, TranslateMessage, UnregisterClassW, HWND_MESSAGE, MSG, WM_APP,
    WM_CLIPBOARDUPDATE, WNDCLASSW,
};

const MAX_NATIVE_TEXT_BYTES: usize = 512 * 1024;
const MAX_MARKER_BYTES: usize = 128;
const MAX_OPEN_ATTEMPTS: usize = 3;
const CF_UNICODETEXT: u32 = 13;
const WM_STOP_LISTENER: u32 = WM_APP + 0x510;
const WM_WRITE_TEXT: u32 = WM_APP + 0x511;
static NEXT_CLASS_ID: AtomicU64 = AtomicU64::new(1);

pub(crate) fn decode_text(units: &[u16], max_utf8_bytes: usize) -> Option<String> {
    let end = units.iter().position(|unit| *unit == 0)?;
    let text = String::from_utf16(&units[..end]).ok()?;
    (text.len() <= max_utf8_bytes).then_some(text)
}

pub(crate) fn is_restore_echo(
    sequence: u32,
    marker: Option<&str>,
    pending: Option<(u32, &str)>,
) -> bool {
    pending.is_some_and(|(expected_sequence, expected_marker)| {
        sequence == expected_sequence && marker == Some(expected_marker)
    })
}

enum ListenerCommand {
    Write {
        text: String,
        marker: String,
        response: Sender<Result<(), ClipboardBackendError>>,
        gate: Arc<WriteGate>,
    },
}

#[derive(Default)]
struct WriteGate(Mutex<bool>);

impl WriteGate {
    fn begin_submission(&self) -> MutexGuard<'_, bool> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn should_execute(&self) -> bool {
        *self.begin_submission()
    }
}

struct ListenerHandle {
    hwnd: usize,
    commands: Sender<ListenerCommand>,
    thread: JoinHandle<()>,
}

pub struct WindowsClipboardBackend {
    listener: Mutex<Option<ListenerHandle>>,
}

impl Default for WindowsClipboardBackend {
    fn default() -> Self {
        Self {
            listener: Mutex::new(None),
        }
    }
}

impl ClipboardBackend for WindowsClipboardBackend {
    fn start(&self, observer: ClipboardObserver) -> Result<(), ClipboardBackendError> {
        let mut slot = self
            .listener
            .lock()
            .map_err(|_| ClipboardBackendError::Unavailable)?;
        if slot.is_some() {
            return Err(ClipboardBackendError::Busy);
        }
        let (ready_tx, ready_rx) = mpsc::channel();
        let (command_tx, command_rx) = mpsc::channel();
        let thread = thread::Builder::new()
            .name("widget-platform-clipboard".into())
            .spawn(move || listener_thread(observer, command_rx, ready_tx))
            .map_err(|_| ClipboardBackendError::Unavailable)?;
        let hwnd = match ready_rx.recv() {
            Ok(Ok(hwnd)) => hwnd,
            _ => {
                let _ = thread.join();
                return Err(ClipboardBackendError::Unavailable);
            }
        };
        *slot = Some(ListenerHandle {
            hwnd,
            commands: command_tx,
            thread,
        });
        Ok(())
    }

    fn stop(&self) -> Result<(), ClipboardBackendError> {
        let mut slot = self
            .listener
            .lock()
            .map_err(|_| ClipboardBackendError::Unavailable)?;
        let Some(handle) = slot.take() else {
            return Ok(());
        };
        let posted = unsafe {
            PostMessageW(
                Some(HWND(handle.hwnd as *mut _)),
                WM_STOP_LISTENER,
                WPARAM(0),
                LPARAM(0),
            )
        };
        if posted.is_err() {
            *slot = Some(handle);
            return Err(ClipboardBackendError::Unavailable);
        }
        handle
            .thread
            .join()
            .map_err(|_| ClipboardBackendError::Unavailable)
    }

    fn write_text(&self, text: &str, marker: &str) -> Result<(), ClipboardBackendError> {
        if text.is_empty()
            || text.len() > MAX_NATIVE_TEXT_BYTES
            || marker.is_empty()
            || marker.len() > MAX_MARKER_BYTES
            || !marker.is_ascii()
        {
            return Err(ClipboardBackendError::Unavailable);
        }
        let slot = self
            .listener
            .lock()
            .map_err(|_| ClipboardBackendError::Unavailable)?;
        let handle = slot.as_ref().ok_or(ClipboardBackendError::Unavailable)?;
        let (tx, rx) = mpsc::channel();
        let gate = Arc::new(WriteGate::default());
        let mut submission = gate.begin_submission();
        handle
            .commands
            .send(ListenerCommand::Write {
                text: text.to_owned(),
                marker: marker.to_owned(),
                response: tx,
                gate: Arc::clone(&gate),
            })
            .map_err(|_| ClipboardBackendError::Unavailable)?;
        let posted = unsafe {
            PostMessageW(
                Some(HWND(handle.hwnd as *mut _)),
                WM_WRITE_TEXT,
                WPARAM(0),
                LPARAM(0),
            )
        };
        *submission = posted.is_ok();
        drop(submission);
        posted.map_err(|_| ClipboardBackendError::Unavailable)?;
        rx.recv().map_err(|_| ClipboardBackendError::Unavailable)?
    }
}

impl Drop for WindowsClipboardBackend {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn listener_thread(
    observer: ClipboardObserver,
    commands: Receiver<ListenerCommand>,
    ready: Sender<Result<usize, ()>>,
) {
    let class_name: Vec<u16> = format!(
        "WidgetPlatformClipboard-{}-{}",
        std::process::id(),
        NEXT_CLASS_ID.fetch_add(1, Ordering::Relaxed)
    )
    .encode_utf16()
    .chain(std::iter::once(0))
    .collect();
    let class_ptr = PCWSTR(class_name.as_ptr());
    let Ok(module) = (unsafe { GetModuleHandleW(None) }) else {
        let _ = ready.send(Err(()));
        return;
    };
    let instance = HINSTANCE(module.0);
    let class = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class_ptr,
        ..Default::default()
    };
    if unsafe { RegisterClassW(&class) } == 0 {
        let _ = ready.send(Err(()));
        return;
    }
    let window = unsafe {
        CreateWindowExW(
            Default::default(),
            class_ptr,
            w!(""),
            Default::default(),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(instance),
            None,
        )
    };
    let Ok(hwnd) = window else {
        unsafe {
            let _ = UnregisterClassW(class_ptr, Some(instance));
        }
        let _ = ready.send(Err(()));
        return;
    };
    let marker_format = unsafe { RegisterClipboardFormatW(w!("WidgetPlatform.RestoreMarker.v1")) };
    let exclude_format =
        unsafe { RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing")) };
    let can_include_format =
        unsafe { RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory")) };
    if marker_format == 0
        || exclude_format == 0
        || can_include_format == 0
        || unsafe { AddClipboardFormatListener(hwnd) }.is_err()
    {
        unsafe {
            let _ = DestroyWindow(hwnd);
            let _ = UnregisterClassW(class_ptr, Some(instance));
        }
        let _ = ready.send(Err(()));
        return;
    }
    let _ = ready.send(Ok(hwnd.0 as usize));
    let mut pending: Option<(u32, String)> = None;
    let mut message = MSG::default();
    loop {
        let status = unsafe { GetMessageW(&mut message, Some(hwnd), 0, 0) };
        if status.0 <= 0 || message.message == WM_STOP_LISTENER {
            break;
        }
        match message.message {
            WM_WRITE_TEXT => {
                while let Ok(ListenerCommand::Write {
                    text,
                    marker,
                    response,
                    gate,
                }) = commands.try_recv()
                {
                    if !gate.should_execute() {
                        let _ = response.send(Err(ClipboardBackendError::Unavailable));
                        continue;
                    }
                    let result = write_unicode_text(hwnd, &text, &marker, marker_format);
                    if let Ok(sequence) = result {
                        pending = Some((sequence, marker));
                    }
                    let _ = response.send(result.map(|_| ()));
                }
            }
            WM_CLIPBOARDUPDATE => {
                if let Some((sequence, marker, text, exclude_from_history)) =
                    read_clipboard_text(marker_format, exclude_format, can_include_format)
                {
                    let echo = is_restore_echo(
                        sequence,
                        marker.as_deref(),
                        pending.as_ref().map(|(seq, value)| (*seq, value.as_str())),
                    );
                    if echo {
                        pending = None;
                    }
                    observer(ObservedClipboardText {
                        text,
                        observed_at_ms: now_ms(),
                        source_app_id: None,
                        exclude_from_history,
                        restore_marker: echo.then(|| marker.unwrap_or_default()),
                    });
                }
            }
            _ => unsafe {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            },
        }
    }
    unsafe {
        let _ = RemoveClipboardFormatListener(hwnd);
        let _ = DestroyWindow(hwnd);
        let _ = UnregisterClassW(class_ptr, Some(instance));
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

struct OpenClipboardGuard;
impl Drop for OpenClipboardGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseClipboard();
        }
    }
}

fn open_clipboard(owner: Option<HWND>) -> Result<OpenClipboardGuard, ClipboardBackendError> {
    for attempt in 0..MAX_OPEN_ATTEMPTS {
        if unsafe { OpenClipboard(owner) }.is_ok() {
            return Ok(OpenClipboardGuard);
        }
        if attempt + 1 < MAX_OPEN_ATTEMPTS {
            thread::sleep(Duration::from_millis(10));
        }
    }
    Err(ClipboardBackendError::Busy)
}

fn read_clipboard_text(
    marker_format: u32,
    exclude_format: u32,
    can_include_format: u32,
) -> Option<(u32, Option<String>, String, bool)> {
    let _guard = open_clipboard(None).ok()?;
    let sequence = unsafe { GetClipboardSequenceNumber() };
    unsafe { IsClipboardFormatAvailable(CF_UNICODETEXT) }.ok()?;
    let text_handle = unsafe { GetClipboardData(CF_UNICODETEXT) }.ok()?;
    let text = read_global_utf16(HGLOBAL(text_handle.0), MAX_NATIVE_TEXT_BYTES)?;
    let marker = unsafe { GetClipboardData(marker_format) }
        .ok()
        .and_then(|handle| read_global_ascii(HGLOBAL(handle.0), MAX_MARKER_BYTES));
    let exclude_format_present = unsafe { IsClipboardFormatAvailable(exclude_format) }.is_ok();
    let can_include = unsafe { GetClipboardData(can_include_format) }
        .ok()
        .and_then(|handle| read_global_u32(HGLOBAL(handle.0)));
    Some((
        sequence,
        marker,
        text,
        privacy_excludes_history(exclude_format_present, can_include),
    ))
}

fn privacy_excludes_history(exclude_format_present: bool, can_include: Option<u32>) -> bool {
    exclude_format_present || can_include == Some(0)
}

fn read_global_utf16(handle: HGLOBAL, max_bytes: usize) -> Option<String> {
    let bytes = unsafe { GlobalSize(handle) };
    if bytes < 2 || bytes > max_bytes.saturating_mul(2).saturating_add(2) || bytes % 2 != 0 {
        return None;
    }
    let ptr = unsafe { GlobalLock(handle) } as *const u16;
    if ptr.is_null() {
        return None;
    }
    let result = decode_text(
        unsafe { std::slice::from_raw_parts(ptr, bytes / 2) },
        max_bytes,
    );
    unsafe {
        let _ = GlobalUnlock(handle);
    }
    result
}

fn read_global_ascii(handle: HGLOBAL, max_bytes: usize) -> Option<String> {
    let bytes = unsafe { GlobalSize(handle) };
    if bytes < 2 || bytes > max_bytes + 1 {
        return None;
    }
    let ptr = unsafe { GlobalLock(handle) } as *const u8;
    if ptr.is_null() {
        return None;
    }
    let contents = unsafe { std::slice::from_raw_parts(ptr, bytes) };
    let result = contents.iter().position(|byte| *byte == 0).and_then(|end| {
        (end > 0 && end <= max_bytes && contents[..end].is_ascii())
            .then(|| String::from_utf8(contents[..end].to_vec()).ok())
            .flatten()
    });
    unsafe {
        let _ = GlobalUnlock(handle);
    }
    result
}

fn read_global_u32(handle: HGLOBAL) -> Option<u32> {
    if unsafe { GlobalSize(handle) } < std::mem::size_of::<u32>() {
        return None;
    }
    let ptr = unsafe { GlobalLock(handle) } as *const u32;
    if ptr.is_null() {
        return None;
    }
    let value = unsafe { *ptr };
    unsafe {
        let _ = GlobalUnlock(handle);
    }
    Some(value)
}

struct OwnedGlobal(HGLOBAL);
impl Drop for OwnedGlobal {
    fn drop(&mut self) {
        unsafe {
            let _ = GlobalFree(Some(self.0));
        }
    }
}

fn allocate_global(bytes: &[u8]) -> Result<OwnedGlobal, ClipboardBackendError> {
    let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len()) }
        .map_err(|_| ClipboardBackendError::Unavailable)?;
    let memory = OwnedGlobal(handle);
    let ptr = unsafe { GlobalLock(handle) } as *mut u8;
    if ptr.is_null() {
        return Err(ClipboardBackendError::Unavailable);
    }
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        let _ = GlobalUnlock(handle);
    }
    Ok(memory)
}

fn write_unicode_text(
    owner: HWND,
    text: &str,
    marker: &str,
    marker_format: u32,
) -> Result<u32, ClipboardBackendError> {
    let units: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let utf16_bytes: Vec<u8> = units.iter().flat_map(|unit| unit.to_le_bytes()).collect();
    let marker_bytes: Vec<u8> = marker.bytes().chain(std::iter::once(0)).collect();
    let mut text_memory = Some(allocate_global(&utf16_bytes)?);
    let mut marker_memory = Some(allocate_global(&marker_bytes)?);
    let _guard = open_clipboard(Some(owner))?;
    unsafe { EmptyClipboard() }.map_err(|_| ClipboardBackendError::Unavailable)?;
    write_formats(marker_format, |format| {
        let memory = if format == marker_format {
            &mut marker_memory
        } else {
            &mut text_memory
        };
        let handle = memory.as_ref().ok_or(ClipboardBackendError::Unavailable)?.0;
        unsafe { SetClipboardData(format, Some(HANDLE(handle.0))) }
            .map_err(|_| ClipboardBackendError::Unavailable)?;
        std::mem::forget(memory.take().expect("successful transfer owns the handle"));
        Ok(())
    })?;
    Ok(unsafe { GetClipboardSequenceNumber() })
}

fn write_formats<F>(marker_format: u32, mut set_format: F) -> Result<(), ClipboardBackendError>
where
    F: FnMut(u32) -> Result<(), ClipboardBackendError>,
{
    set_format(marker_format)?;
    set_format(CF_UNICODETEXT)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::{
        privacy_excludes_history, write_formats, ClipboardBackendError, WriteGate, CF_UNICODETEXT,
    };
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn failed_post_never_executes_a_queued_write() {
        let gate = Arc::new(WriteGate::default());
        let executed = Arc::new(AtomicBool::new(false));
        let worker_gate = Arc::clone(&gate);
        let worker_executed = Arc::clone(&executed);
        let mut submission = gate.begin_submission();
        let worker = thread::spawn(move || {
            if worker_gate.should_execute() {
                worker_executed.store(true, Ordering::SeqCst);
            }
        });
        *submission = false;
        drop(submission);
        worker.join().unwrap();
        assert!(!executed.load(Ordering::SeqCst));
    }

    #[test]
    fn marker_failure_never_publishes_restored_text() {
        let marker_format = 0xc123;
        let mut published = Vec::new();
        let result = write_formats(marker_format, |format| {
            if format == marker_format {
                return Err(ClipboardBackendError::Unavailable);
            }
            published.push(format);
            Ok(())
        });
        assert_eq!(result, Err(ClipboardBackendError::Unavailable));
        assert!(!published.contains(&CF_UNICODETEXT));
    }

    #[test]
    fn successful_restore_publishes_marker_before_text() {
        let marker_format = 0xc123;
        let mut published = Vec::new();
        write_formats(marker_format, |format| {
            published.push(format);
            Ok(())
        })
        .unwrap();
        assert_eq!(published, [marker_format, CF_UNICODETEXT]);
    }

    #[test]
    fn explicit_history_exclusion_skips_private_text() {
        assert!(privacy_excludes_history(true, None));
        assert!(privacy_excludes_history(false, Some(0)));
        assert!(!privacy_excludes_history(false, Some(1)));
        assert!(!privacy_excludes_history(false, None));
    }
}

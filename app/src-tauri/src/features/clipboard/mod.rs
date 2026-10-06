pub mod commands;
mod model;
mod protection;
mod runtime;
mod store;
#[cfg(target_os = "windows")]
mod windows_backend;

pub use commands::{
    clipboard_clear, clipboard_delete, clipboard_get_snapshot, clipboard_restore,
    clipboard_set_enabled, clipboard_set_pinned, ClipboardCommandError, ClipboardState,
};
pub use model::{
    CaptureCandidate, CaptureOutcome, ClearScope, ClipboardEntry, ClipboardHistory,
    ClipboardPolicy, ExclusionReason, PinOutcome, RestorePayload,
};
pub use protection::{
    protect_text, unprotect_text, ClipboardProtectionError, ProtectedClipboardText,
    ProtectionScope, TextProtector, WindowsDpapiProtector,
};
pub use runtime::{
    ClipboardBackend, ClipboardBackendError, ClipboardObserver, ClipboardRuntime,
    ClipboardRuntimeError, ClipboardSnapshot, ObservedClipboardText,
};
pub use store::{ClipboardStorageError, ClipboardStore, StoredClipboardSnapshot};
#[cfg(target_os = "windows")]
pub use windows_backend::WindowsClipboardBackend;

#[cfg(test)]
mod tests;

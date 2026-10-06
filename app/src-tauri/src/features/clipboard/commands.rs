use super::{ClearScope, ClipboardRuntime, ClipboardRuntimeError, ClipboardSnapshot, PinOutcome};
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ClipboardCommandError {
    Unavailable,
    Runtime(ClipboardRuntimeError),
}

impl From<ClipboardRuntimeError> for ClipboardCommandError {
    fn from(value: ClipboardRuntimeError) -> Self {
        Self::Runtime(value)
    }
}

pub struct ClipboardState {
    runtime: Option<Arc<ClipboardRuntime>>,
    unavailable: Option<ClipboardCommandError>,
}

impl ClipboardState {
    pub fn available(runtime: ClipboardRuntime) -> Self {
        Self {
            runtime: Some(Arc::new(runtime)),
            unavailable: None,
        }
    }

    pub fn unavailable(error: ClipboardCommandError) -> Self {
        Self {
            runtime: None,
            unavailable: Some(error),
        }
    }

    fn runtime(&self) -> Result<&ClipboardRuntime, ClipboardCommandError> {
        self.runtime.as_deref().ok_or(
            self.unavailable
                .unwrap_or(ClipboardCommandError::Unavailable),
        )
    }
}

fn parse_scope(value: &str) -> Option<ClearScope> {
    match value {
        "unpinned" => Some(ClearScope::Unpinned),
        "all" => Some(ClearScope::All),
        _ => None,
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[tauri::command]
pub fn clipboard_get_snapshot(
    state: State<'_, ClipboardState>,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<ClipboardSnapshot, ClipboardCommandError> {
    state
        .runtime()?
        .snapshot(now_ms(), offset.unwrap_or(0), limit.unwrap_or(50))
        .map_err(Into::into)
}

#[tauri::command]
pub fn clipboard_set_enabled(
    state: State<'_, ClipboardState>,
    enabled: bool,
) -> Result<ClipboardSnapshot, ClipboardCommandError> {
    let runtime = state.runtime()?;
    runtime.set_enabled(enabled)?;
    runtime.snapshot(now_ms(), 0, 50).map_err(Into::into)
}

#[tauri::command]
pub fn clipboard_set_pinned(
    state: State<'_, ClipboardState>,
    entry_id: String,
    pinned: bool,
) -> Result<PinOutcome, ClipboardCommandError> {
    state
        .runtime()?
        .set_pinned(now_ms(), &entry_id, pinned)
        .map_err(Into::into)
}

#[tauri::command]
pub fn clipboard_delete(
    state: State<'_, ClipboardState>,
    entry_id: String,
) -> Result<bool, ClipboardCommandError> {
    state.runtime()?.delete(&entry_id).map_err(Into::into)
}

#[tauri::command]
pub fn clipboard_clear(
    state: State<'_, ClipboardState>,
    scope: String,
) -> Result<usize, ClipboardCommandError> {
    let scope = parse_scope(&scope).ok_or(ClipboardCommandError::Unavailable)?;
    state.runtime()?.clear(scope).map_err(Into::into)
}

#[tauri::command]
pub fn clipboard_restore(
    state: State<'_, ClipboardState>,
    entry_id: String,
    action_id: String,
) -> Result<(), ClipboardCommandError> {
    state
        .runtime()?
        .restore(now_ms(), &entry_id, &action_id)
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::parse_scope;
    use crate::features::clipboard::ClearScope;

    #[test]
    fn clear_scope_parser_accepts_only_explicit_scopes() {
        assert_eq!(parse_scope("unpinned"), Some(ClearScope::Unpinned));
        assert_eq!(parse_scope("all"), Some(ClearScope::All));
        assert_eq!(parse_scope("everything"), None);
    }
}

use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use super::{MediaBridgeError, MediaControlAction, MediaMonitor, MediaSnapshot};

#[derive(Default)]
pub struct MediaRuntime {
    inner: Mutex<RuntimeInner>,
}

#[derive(Default)]
struct RuntimeInner {
    monitor: Option<MediaMonitor>,
    consumers: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaArtworkPayload {
    content_type: String,
    bytes: Vec<u8>,
}

impl MediaRuntime {
    fn subscribe(&self) -> Result<MediaSnapshot, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "MEDIA_STATE_UNAVAILABLE".to_string())?;
        if inner.monitor.is_none() {
            inner.monitor = Some(MediaMonitor::start().map_err(error_code)?);
        }
        inner.consumers = inner.consumers.saturating_add(1);
        Ok(inner
            .monitor
            .as_ref()
            .map(MediaMonitor::snapshot)
            .unwrap_or_default())
    }

    fn snapshot(&self) -> Result<MediaSnapshot, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "MEDIA_STATE_UNAVAILABLE".to_string())?;
        Ok(inner
            .monitor
            .as_ref()
            .map(MediaMonitor::snapshot)
            .unwrap_or_default())
    }

    fn unsubscribe(&self) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "MEDIA_STATE_UNAVAILABLE".to_string())?;
        inner.consumers = inner.consumers.saturating_sub(1);
        if inner.consumers == 0 {
            if let Some(monitor) = inner.monitor.take() {
                monitor.stop();
            }
        }
        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn artwork(&self, reference: &str) -> Result<MediaArtworkPayload, String> {
        let job = {
            let inner = self
                .inner
                .lock()
                .map_err(|_| "MEDIA_STATE_UNAVAILABLE".to_string())?;
            inner
                .monitor
                .as_ref()
                .ok_or_else(|| "MEDIA_NOT_SUBSCRIBED".to_string())?
                .request_artwork(reference)
                .map_err(error_code)?
        };
        let artwork = job
            .wait_timeout(std::time::Duration::from_secs(5))
            .map_err(error_code)?
            .ok_or_else(|| "MEDIA_ARTWORK_TIMED_OUT".to_string())?;
        Ok(MediaArtworkPayload {
            content_type: artwork.content_type,
            bytes: artwork.bytes,
        })
    }

    #[cfg(target_os = "windows")]
    fn control(
        &self,
        session_id: &str,
        action: MediaControlAction,
        position_ms: Option<u64>,
    ) -> Result<bool, String> {
        if session_id.is_empty() || session_id.len() > 128 {
            return Err(error_code(MediaBridgeError::InvalidControlRequest));
        }
        let job = {
            let inner = self
                .inner
                .lock()
                .map_err(|_| "MEDIA_STATE_UNAVAILABLE".to_string())?;
            inner
                .monitor
                .as_ref()
                .ok_or_else(|| "MEDIA_NOT_SUBSCRIBED".to_string())?
                .request_control(session_id, action, position_ms)
                .map_err(error_code)?
        };
        job.wait_timeout(std::time::Duration::from_secs(5))
            .map_err(error_code)
    }
}

fn error_code(error: MediaBridgeError) -> String {
    match error {
        MediaBridgeError::UnsupportedPlatform => "MEDIA_UNSUPPORTED",
        MediaBridgeError::Stopped => "MEDIA_STOPPED",
        MediaBridgeError::Busy => "MEDIA_BUSY",
        MediaBridgeError::SessionNotFound => "MEDIA_SESSION_NOT_FOUND",
        MediaBridgeError::ControlUnsupported => "MEDIA_CONTROL_UNSUPPORTED",
        MediaBridgeError::InvalidControlRequest => "MEDIA_INVALID_CONTROL_REQUEST",
        MediaBridgeError::ControlFailed => "MEDIA_CONTROL_FAILED",
        MediaBridgeError::ArtworkUnavailable => "MEDIA_ARTWORK_UNAVAILABLE",
        MediaBridgeError::ArtworkTooLarge => "MEDIA_ARTWORK_TOO_LARGE",
        MediaBridgeError::OperationTimedOut => "MEDIA_OPERATION_TIMED_OUT",
        MediaBridgeError::ProviderUnavailable => "MEDIA_PROVIDER_UNAVAILABLE",
    }
    .to_string()
}

#[tauri::command]
pub fn media_subscribe(state: State<'_, MediaRuntime>) -> Result<MediaSnapshot, String> {
    state.subscribe()
}

#[tauri::command]
pub fn media_get_snapshot(state: State<'_, MediaRuntime>) -> Result<MediaSnapshot, String> {
    state.snapshot()
}

#[tauri::command]
pub fn media_unsubscribe(state: State<'_, MediaRuntime>) -> Result<(), String> {
    state.unsubscribe()
}

#[tauri::command]
pub fn media_get_artwork(
    state: State<'_, MediaRuntime>,
    reference: String,
) -> Result<MediaArtworkPayload, String> {
    #[cfg(target_os = "windows")]
    {
        state.artwork(&reference)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (state, reference);
        Err(error_code(MediaBridgeError::UnsupportedPlatform))
    }
}

#[tauri::command]
pub fn media_control(
    state: State<'_, MediaRuntime>,
    session_id: String,
    action: MediaControlAction,
    position_ms: Option<u64>,
) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        state.control(&session_id, action, position_ms)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (state, session_id, action, position_ms);
        Err(error_code(MediaBridgeError::UnsupportedPlatform))
    }
}

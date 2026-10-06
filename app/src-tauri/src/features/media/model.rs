use serde::{Deserialize, Serialize};

pub const MAX_METADATA_CHARS: usize = 1024;
pub const MAX_ARTWORK_BYTES: u64 = 3 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSnapshot {
    pub observed_at_ms: i64,
    pub health: MediaHealth,
    pub error: Option<MediaErrorKind>,
    pub current_session_id: Option<String>,
    pub sessions: Vec<MediaSession>,
}

impl Default for MediaSnapshot {
    fn default() -> Self {
        Self {
            observed_at_ms: 0,
            health: MediaHealth::Connecting,
            error: None,
            current_session_id: None,
            sessions: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaHealth {
    #[default]
    Connecting,
    Available,
    Partial,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaErrorKind {
    AccessDenied,
    OperationTimedOut,
    ProviderUnavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaPlaybackState {
    Closed,
    Opened,
    Changing,
    Stopped,
    Playing,
    Paused,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaControlAction {
    Play,
    Pause,
    Previous,
    Next,
    Seek,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ValidatedMediaControl {
    pub action: MediaControlAction,
    /// Absolute GSMTC playback position in 100 ns ticks. Present for seek only.
    pub position_ticks: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSession {
    /// Opaque and stable only for the lifetime of this session in this monitor.
    pub session_id: String,
    pub source_app_user_model_id: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_title: Option<String>,
    /// Opaque reference. Artwork bytes are fetched separately on demand.
    pub artwork_ref: Option<String>,
    pub playback_state: Option<MediaPlaybackState>,
    pub timeline: MediaTimeline,
    pub capabilities: MediaCapabilities,
    pub quality: MediaHealth,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTimeline {
    pub start_ms: Option<u64>,
    pub end_ms: Option<u64>,
    pub position_ms: Option<u64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaCapabilities {
    pub can_play: Option<bool>,
    pub can_pause: Option<bool>,
    pub can_previous: Option<bool>,
    pub can_next: Option<bool>,
    pub can_seek: Option<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MediaBridgeError {
    UnsupportedPlatform,
    Stopped,
    Busy,
    SessionNotFound,
    ControlUnsupported,
    InvalidControlRequest,
    ControlFailed,
    ArtworkUnavailable,
    ArtworkTooLarge,
    OperationTimedOut,
    ProviderUnavailable,
}

pub(crate) fn dispatch_media_control(
    session: &MediaSession,
    action: MediaControlAction,
    position_ms: Option<u64>,
    invoke: impl FnOnce(ValidatedMediaControl) -> Result<bool, MediaBridgeError>,
) -> Result<bool, MediaBridgeError> {
    let capability = match action {
        MediaControlAction::Play => session.capabilities.can_play,
        MediaControlAction::Pause => session.capabilities.can_pause,
        MediaControlAction::Previous => session.capabilities.can_previous,
        MediaControlAction::Next => session.capabilities.can_next,
        MediaControlAction::Seek => session.capabilities.can_seek,
    };
    if capability != Some(true) {
        return Err(MediaBridgeError::ControlUnsupported);
    }

    let position_ticks = match action {
        MediaControlAction::Seek => {
            let requested_ms = position_ms.ok_or(MediaBridgeError::InvalidControlRequest)?;
            let start_ms = session.timeline.start_ms.unwrap_or(0);
            let end_ms = session
                .timeline
                .end_ms
                .ok_or(MediaBridgeError::ControlUnsupported)?;
            let duration_ms = end_ms
                .checked_sub(start_ms)
                .filter(|duration| *duration > 0)
                .ok_or(MediaBridgeError::ControlUnsupported)?;
            let absolute_ms = start_ms.saturating_add(requested_ms.min(duration_ms));
            let ticks = absolute_ms
                .checked_mul(10_000)
                .and_then(|ticks| i64::try_from(ticks).ok())
                .ok_or(MediaBridgeError::InvalidControlRequest)?;
            Some(ticks)
        }
        _ if position_ms.is_some() => {
            return Err(MediaBridgeError::InvalidControlRequest);
        }
        _ => None,
    };

    invoke(ValidatedMediaControl {
        action,
        position_ticks,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArtworkError {
    Empty,
    TooLarge,
}

pub fn normalize_metadata(value: &str) -> Option<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return None;
    }

    let bounded: String = normalized.chars().take(MAX_METADATA_CHARS).collect();
    Some(bounded)
}

/// GSMTC TimeSpan values use 100 ns units. Reject negative values instead of
/// wrapping them into an apparently huge positive duration.
pub fn duration_100ns_to_ms(value: i64) -> Option<u64> {
    u64::try_from(value).ok().map(|ticks| ticks / 10_000)
}

pub fn artwork_length(size: u64) -> Result<usize, ArtworkError> {
    if size == 0 {
        return Err(ArtworkError::Empty);
    }
    if size > MAX_ARTWORK_BYTES {
        return Err(ArtworkError::TooLarge);
    }
    usize::try_from(size).map_err(|_| ArtworkError::TooLarge)
}

pub(crate) fn artwork_reference(session_id: &str, revision: u64) -> String {
    format!("{session_id}/artwork/{revision}")
}

pub(crate) fn error_kind_from_hresult(code: i32) -> MediaErrorKind {
    const E_ACCESSDENIED: i32 = 0x8007_0005u32 as i32;
    if code == E_ACCESSDENIED {
        MediaErrorKind::AccessDenied
    } else {
        MediaErrorKind::ProviderUnavailable
    }
}

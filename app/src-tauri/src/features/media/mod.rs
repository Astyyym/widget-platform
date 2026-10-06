pub mod commands;

mod model;

#[cfg(target_os = "windows")]
mod winrt;

#[cfg(not(target_os = "windows"))]
mod unsupported;

pub use commands::MediaRuntime;
pub use model::{
    ArtworkError, MediaBridgeError, MediaCapabilities, MediaControlAction, MediaErrorKind,
    MediaHealth, MediaPlaybackState, MediaSession, MediaSnapshot, MediaTimeline,
    ValidatedMediaControl, MAX_ARTWORK_BYTES, MAX_METADATA_CHARS,
};

#[cfg(target_os = "windows")]
pub use winrt::{MediaControlJob, MediaMonitor};

#[cfg(not(target_os = "windows"))]
pub use unsupported::MediaMonitor;

#[cfg(test)]
mod tests;

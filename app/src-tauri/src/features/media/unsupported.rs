use super::{MediaBridgeError, MediaSnapshot};

pub struct MediaMonitor;

impl MediaMonitor {
    pub fn start() -> Result<Self, MediaBridgeError> {
        Err(MediaBridgeError::UnsupportedPlatform)
    }

    pub fn snapshot(&self) -> MediaSnapshot {
        MediaSnapshot {
            health: super::MediaHealth::Unavailable,
            error: Some(super::MediaErrorKind::ProviderUnavailable),
            ..MediaSnapshot::default()
        }
    }

    pub fn stop(self) {}
}

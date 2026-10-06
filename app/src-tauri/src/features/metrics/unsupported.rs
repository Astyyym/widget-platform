use super::MetricsSnapshot;

pub struct MetricsState;

impl MetricsState {
    pub fn new() -> Self {
        Self
    }

    pub fn sample(&self, _session_id: &str) -> MetricsSnapshot {
        MetricsSnapshot::unavailable(1, 0)
    }
}

impl Default for MetricsState {
    fn default() -> Self {
        Self::new()
    }
}

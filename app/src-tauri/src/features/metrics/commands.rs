use tauri::State;

use super::{MetricsSnapshot, MetricsState};

#[tauri::command]
pub fn metrics_sample(state: State<'_, MetricsState>, session_id: String) -> MetricsSnapshot {
    state.sample(&session_id)
}

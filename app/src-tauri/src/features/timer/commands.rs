use super::model::{TimerError, TimerPhase, TimerSnapshot};
use super::store::{TimerMutation, TimerState};
use tauri::{AppHandle, Emitter, State};

pub const TIMER_CHANGED_EVENT: &str = "timer://changed";

#[tauri::command]
pub fn timer_get_snapshot(state: State<'_, TimerState>) -> Result<TimerSnapshot, TimerError> {
    state.get_snapshot()
}

#[tauri::command]
pub fn timer_start(
    app: AppHandle,
    state: State<'_, TimerState>,
    action_id: String,
    phase: TimerPhase,
    duration_ms: i64,
) -> Result<TimerSnapshot, TimerError> {
    emit_mutation(&app, state.start(&action_id, phase, duration_ms)?)
}

#[tauri::command]
pub fn timer_pause(
    app: AppHandle,
    state: State<'_, TimerState>,
    action_id: String,
) -> Result<TimerSnapshot, TimerError> {
    emit_mutation(&app, state.pause(&action_id)?)
}

#[tauri::command]
pub fn timer_resume(
    app: AppHandle,
    state: State<'_, TimerState>,
    action_id: String,
) -> Result<TimerSnapshot, TimerError> {
    emit_mutation(&app, state.resume(&action_id)?)
}

#[tauri::command]
pub fn timer_reset(
    app: AppHandle,
    state: State<'_, TimerState>,
    action_id: String,
    duration_ms: Option<i64>,
) -> Result<TimerSnapshot, TimerError> {
    emit_mutation(&app, state.reset(&action_id, duration_ms)?)
}

#[tauri::command]
pub fn timer_expire(
    app: AppHandle,
    state: State<'_, TimerState>,
    action_id: String,
    generation: u64,
) -> Result<TimerSnapshot, TimerError> {
    emit_mutation(&app, state.expire(&action_id, generation)?)
}

fn emit_mutation(app: &AppHandle, mutation: TimerMutation) -> Result<TimerSnapshot, TimerError> {
    if mutation.changed {
        let _ = app.emit(TIMER_CHANGED_EVENT, &mutation.snapshot);
    }
    Ok(mutation.snapshot)
}

use super::model::{TodoError, TodoSnapshot};
use super::store::{TodoMutation, TodoState};
use tauri::{AppHandle, Emitter, State};

pub const TODO_CHANGED_EVENT: &str = "todo://changed";

#[tauri::command]
pub fn todo_get_snapshot(state: State<'_, TodoState>) -> Result<TodoSnapshot, TodoError> {
    state.get_snapshot()
}

#[tauri::command]
pub fn todo_add(
    app: AppHandle,
    state: State<'_, TodoState>,
    action_id: String,
    text: String,
) -> Result<TodoSnapshot, TodoError> {
    emit_mutation(&app, state.add(&action_id, &text)?)
}

#[tauri::command]
pub fn todo_set_completed(
    app: AppHandle,
    state: State<'_, TodoState>,
    action_id: String,
    id: String,
    completed: bool,
) -> Result<TodoSnapshot, TodoError> {
    emit_mutation(&app, state.set_completed(&action_id, &id, completed)?)
}

#[tauri::command]
pub fn todo_delete(
    app: AppHandle,
    state: State<'_, TodoState>,
    action_id: String,
    id: String,
) -> Result<TodoSnapshot, TodoError> {
    emit_mutation(&app, state.delete(&action_id, &id)?)
}

#[tauri::command]
pub fn todo_reorder(
    app: AppHandle,
    state: State<'_, TodoState>,
    action_id: String,
    ordered_ids: Vec<String>,
) -> Result<TodoSnapshot, TodoError> {
    emit_mutation(&app, state.reorder(&action_id, &ordered_ids)?)
}

fn emit_mutation(app: &AppHandle, mutation: TodoMutation) -> Result<TodoSnapshot, TodoError> {
    if mutation.changed {
        let _ = app.emit(TODO_CHANGED_EVENT, &mutation.snapshot);
    }
    Ok(mutation.snapshot)
}

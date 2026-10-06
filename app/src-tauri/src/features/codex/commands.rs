use super::model::CodexQuotaError;
use super::runtime::CodexRuntime;
use super::transport::{CodexAppServerClient, CodexAppServerConfig};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn codex_quota_read(runtime: State<'_, CodexRuntime>) -> Result<Value, CodexQuotaError> {
    let ticket = runtime.begin()?;
    let mut cancellation_guard = ticket.cancellation_guard();
    let cancellation = ticket.cancellation();
    let config = match CodexAppServerConfig::from_environment() {
        Ok(config) => config,
        Err(error) => {
            ticket.complete(false);
            cancellation_guard.disarm();
            return Err(error);
        }
    };

    let result = tauri::async_runtime::spawn_blocking(move || {
        let result = CodexAppServerClient::new(config).read_quota(&cancellation);
        ticket.complete(result.is_ok());
        result
    })
    .await
    .unwrap_or_else(|_| Err(CodexQuotaError::failure("transportError")));

    cancellation_guard.disarm();
    result
}

#[tauri::command]
pub fn codex_quota_cancel(runtime: State<'_, CodexRuntime>) -> bool {
    runtime.cancel_active()
}

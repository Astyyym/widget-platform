use super::{
    CaptureCandidate, CaptureOutcome, ClearScope, ClipboardEntry, ClipboardHistory,
    ClipboardPolicy, ClipboardStorageError, ClipboardStore, PinOutcome, TextProtector,
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, Weak};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ClipboardBackendError {
    Unavailable,
    Busy,
    AccessDenied,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ClipboardRuntimeError {
    Storage,
    Backend,
    Disabled,
    NotFoundOrInvalidAction,
    InvalidPolicy,
    CorruptData,
    Poisoned,
}

impl From<ClipboardStorageError> for ClipboardRuntimeError {
    fn from(value: ClipboardStorageError) -> Self {
        match value {
            ClipboardStorageError::CorruptData => Self::CorruptData,
            ClipboardStorageError::InvalidMutation => Self::CorruptData,
            ClipboardStorageError::Open
            | ClipboardStorageError::Database
            | ClipboardStorageError::UnsupportedSchema
            | ClipboardStorageError::Protection => Self::Storage,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObservedClipboardText {
    pub text: String,
    pub observed_at_ms: u64,
    pub source_app_id: Option<String>,
    pub exclude_from_history: bool,
    pub restore_marker: Option<String>,
}

pub type ClipboardObserver = Arc<dyn Fn(ObservedClipboardText) + Send + Sync>;

pub trait ClipboardBackend: Send + Sync {
    fn start(&self, observer: ClipboardObserver) -> Result<(), ClipboardBackendError>;
    fn stop(&self) -> Result<(), ClipboardBackendError>;
    fn write_text(&self, text: &str, marker: &str) -> Result<(), ClipboardBackendError>;
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardSnapshot {
    pub revision: u64,
    pub enabled: bool,
    pub listening: bool,
    pub total_entries: usize,
    pub entries: Vec<ClipboardEntry>,
    pub error: Option<ClipboardRuntimeError>,
}

struct RuntimeState {
    history: ClipboardHistory,
    policy: ClipboardPolicy,
    revision: u64,
    listening: bool,
    cleanup_required: bool,
    listener_generation: u64,
    error: Option<ClipboardRuntimeError>,
}

struct RuntimeCore {
    state: Mutex<RuntimeState>,
    transition: Mutex<()>,
    store: ClipboardStore,
    backend: Arc<dyn ClipboardBackend>,
}

pub struct ClipboardRuntime {
    core: Arc<RuntimeCore>,
}

impl ClipboardRuntime {
    pub fn open(
        path: PathBuf,
        protector: Arc<dyn TextProtector>,
        backend: Arc<dyn ClipboardBackend>,
        mut policy: ClipboardPolicy,
    ) -> Result<Self, ClipboardRuntimeError> {
        policy
            .validate()
            .map_err(|_| ClipboardRuntimeError::InvalidPolicy)?;
        policy.enabled = false;
        let store = ClipboardStore::open(path, protector)?;
        let stored = store.load_snapshot()?;
        let history = ClipboardHistory::from_entries(stored.entries, stored.revision)
            .ok_or(ClipboardRuntimeError::CorruptData)?;
        Ok(Self {
            core: Arc::new(RuntimeCore {
                state: Mutex::new(RuntimeState {
                    history,
                    policy,
                    revision: stored.revision,
                    listening: false,
                    cleanup_required: false,
                    listener_generation: 0,
                    error: None,
                }),
                transition: Mutex::new(()),
                store,
                backend,
            }),
        })
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<(), ClipboardRuntimeError> {
        let _transition = self
            .core
            .transition
            .lock()
            .map_err(|_| ClipboardRuntimeError::Poisoned)?;
        if enabled {
            let cleanup_required = {
                let state = self
                    .core
                    .state
                    .lock()
                    .map_err(|_| ClipboardRuntimeError::Poisoned)?;
                state.cleanup_required
            };
            if cleanup_required {
                if self.core.backend.stop().is_err() {
                    return Err(ClipboardRuntimeError::Backend);
                }
                self.core
                    .state
                    .lock()
                    .map_err(|_| ClipboardRuntimeError::Poisoned)?
                    .cleanup_required = false;
            }
            let generation = {
                let mut state = self
                    .core
                    .state
                    .lock()
                    .map_err(|_| ClipboardRuntimeError::Poisoned)?;
                if state.listening {
                    state.policy.enabled = true;
                    return Ok(());
                }
                state.listener_generation = state.listener_generation.saturating_add(1);
                state.listener_generation
            };
            let weak = Arc::downgrade(&self.core);
            let observer: ClipboardObserver = Arc::new(move |event| {
                capture_observed(&weak, generation, event);
            });
            if self.core.backend.start(observer).is_err() {
                let mut state = self
                    .core
                    .state
                    .lock()
                    .map_err(|_| ClipboardRuntimeError::Poisoned)?;
                if state.listener_generation == generation {
                    state.policy.enabled = false;
                    state.listening = false;
                    state.cleanup_required = true;
                    state.error = Some(ClipboardRuntimeError::Backend);
                }
                return Err(ClipboardRuntimeError::Backend);
            }
            let mut state = self
                .core
                .state
                .lock()
                .map_err(|_| ClipboardRuntimeError::Poisoned)?;
            state.policy.enabled = true;
            state.listening = true;
            state.error = None;
            Ok(())
        } else {
            let should_stop = {
                let mut state = self
                    .core
                    .state
                    .lock()
                    .map_err(|_| ClipboardRuntimeError::Poisoned)?;
                state.listener_generation = state.listener_generation.saturating_add(1);
                state.policy.enabled = false;
                let was_listening = state.listening;
                state.listening = false;
                was_listening || state.cleanup_required
            };
            if should_stop && self.core.backend.stop().is_err() {
                let mut state = self
                    .core
                    .state
                    .lock()
                    .map_err(|_| ClipboardRuntimeError::Poisoned)?;
                state.cleanup_required = true;
                state.error = Some(ClipboardRuntimeError::Backend);
                return Err(ClipboardRuntimeError::Backend);
            }
            self.core
                .state
                .lock()
                .map_err(|_| ClipboardRuntimeError::Poisoned)?
                .cleanup_required = false;
            Ok(())
        }
    }

    pub fn snapshot(
        &self,
        now_ms: u64,
        offset: usize,
        limit: usize,
    ) -> Result<ClipboardSnapshot, ClipboardRuntimeError> {
        let mut state = self
            .core
            .state
            .lock()
            .map_err(|_| ClipboardRuntimeError::Poisoned)?;
        let mut next_history = state.history.clone();
        let evicted_ids = next_history.prune(&state.policy, now_ms);
        if !evicted_ids.is_empty() {
            state.revision = self.core.store.delete_ids(&evicted_ids)?;
        }
        state.history = next_history;
        Ok(ClipboardSnapshot {
            revision: state.revision,
            enabled: state.policy.enabled,
            listening: state.listening,
            total_entries: state.history.len(),
            entries: state.history.page_owned(offset, limit),
            error: state.error,
        })
    }

    pub fn restore(
        &self,
        now_ms: u64,
        entry_id: &str,
        action_id: &str,
    ) -> Result<(), ClipboardRuntimeError> {
        let _transition = self
            .core
            .transition
            .lock()
            .map_err(|_| ClipboardRuntimeError::Poisoned)?;
        let payload = {
            let mut state = self
                .core
                .state
                .lock()
                .map_err(|_| ClipboardRuntimeError::Poisoned)?;
            if !state.policy.enabled || !state.listening {
                return Err(ClipboardRuntimeError::Disabled);
            }
            let policy = state.policy.clone();
            let mut next_history = state.history.clone();
            let evicted_ids = next_history.prune(&policy, now_ms);
            if !evicted_ids.is_empty() {
                state.revision = self.core.store.delete_ids(&evicted_ids)?;
            }
            let payload = next_history
                .prepare_restore(&policy, now_ms, entry_id, action_id)
                .ok_or(ClipboardRuntimeError::NotFoundOrInvalidAction);
            state.history = next_history;
            payload?
        };

        if self
            .core
            .backend
            .write_text(&payload.text, &payload.marker)
            .is_err()
        {
            let mut state = self
                .core
                .state
                .lock()
                .map_err(|_| ClipboardRuntimeError::Poisoned)?;
            state.history.cancel_restore_marker(&payload.marker);
            state.error = Some(ClipboardRuntimeError::Backend);
            return Err(ClipboardRuntimeError::Backend);
        }
        Ok(())
    }

    pub fn set_pinned(
        &self,
        now_ms: u64,
        entry_id: &str,
        pinned: bool,
    ) -> Result<PinOutcome, ClipboardRuntimeError> {
        let mut state = self
            .core
            .state
            .lock()
            .map_err(|_| ClipboardRuntimeError::Poisoned)?;
        let mut next = state.history.clone();
        let result = next.set_pinned(&state.policy, now_ms, entry_id, pinned);
        let deleted_ids: Vec<_> = state
            .history
            .all_entries()
            .iter()
            .filter(|entry| next.entry(&entry.id).is_none())
            .map(|entry| entry.id.clone())
            .collect();
        let pin = matches!(result, PinOutcome::Updated).then_some((entry_id, pinned));
        state.revision = self.core.store.apply_mutation(&deleted_ids, pin)?;
        state.history = next;
        Ok(result)
    }

    pub fn delete(&self, entry_id: &str) -> Result<bool, ClipboardRuntimeError> {
        let mut state = self
            .core
            .state
            .lock()
            .map_err(|_| ClipboardRuntimeError::Poisoned)?;
        let mut next = state.history.clone();
        let deleted = next.delete(entry_id);
        if deleted {
            state.revision = self.core.store.delete_ids(&[entry_id.to_owned()])?;
            state.history = next;
        }
        Ok(deleted)
    }

    pub fn clear(&self, scope: ClearScope) -> Result<usize, ClipboardRuntimeError> {
        let mut state = self
            .core
            .state
            .lock()
            .map_err(|_| ClipboardRuntimeError::Poisoned)?;
        let before = state.history.all_entries();
        let mut next = state.history.clone();
        let removed = next.clear(scope);
        if removed > 0 {
            let ids: Vec<_> = before
                .iter()
                .filter(|entry| next.entry(&entry.id).is_none())
                .map(|entry| entry.id.clone())
                .collect();
            state.revision = self.core.store.delete_ids(&ids)?;
            state.history = next;
        }
        Ok(removed)
    }
}

impl Drop for ClipboardRuntime {
    fn drop(&mut self) {
        if let Ok(mut state) = self.core.state.lock() {
            state.listener_generation = state.listener_generation.saturating_add(1);
            state.policy.enabled = false;
            let should_stop = state.listening || state.cleanup_required;
            state.listening = false;
            drop(state);
            if should_stop {
                let _ = self.core.backend.stop();
            }
        }
    }
}

fn capture_observed(core: &Weak<RuntimeCore>, generation: u64, event: ObservedClipboardText) {
    let Some(core) = core.upgrade() else {
        return;
    };
    let Ok(mut state) = core.state.lock() else {
        return;
    };
    if !state.listening || !state.policy.enabled || state.listener_generation != generation {
        return;
    }

    let mut next_history = state.history.clone();
    let outcome = next_history.capture(
        &state.policy,
        CaptureCandidate {
            text: event.text,
            observed_at_ms: event.observed_at_ms,
            source_app_id: event.source_app_id,
            exclude_from_history: event.exclude_from_history,
            restore_marker: event.restore_marker,
        },
    );
    let inserted_entry = match &outcome {
        CaptureOutcome::Inserted { entry_id, .. } => next_history.entry(entry_id),
        _ => None,
    };
    match core.store.apply_capture(&outcome, inserted_entry.as_ref()) {
        Ok(revision) => {
            state.history = next_history;
            state.revision = revision;
            state.error = None;
        }
        Err(error) => {
            state.error = Some(error.into());
        }
    }
}

use serde::Serialize;
use std::collections::VecDeque;

const MAX_SESSION_ID_BYTES: usize = 256;
const MAX_TURN_ID_BYTES: usize = 256;
const MAX_PROVIDER_BYTES: usize = 128;
const MAX_REMEMBERED_TURN_IDS: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentSessionStatus {
    Working,
    Waiting,
    Done,
    Failed,
    Cancelled,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentStatusQuality {
    Observed,
    Stale,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentStatusSource {
    Hermes,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSnapshot {
    pub source: AgentStatusSource,
    pub session_id: String,
    pub provider: Option<String>,
    pub status: AgentSessionStatus,
    pub quality: AgentStatusQuality,
    pub observed_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AgentSessionEvent {
    TurnStarted {
        session_id: String,
        turn_id: String,
        provider: Option<String>,
        observed_at_ms: i64,
    },
    TurnEnded {
        session_id: String,
        turn_id: Option<String>,
        completed: bool,
        failed: bool,
        interrupted: bool,
        observed_at_ms: i64,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct AgentSessionReducer {
    session_id: String,
    snapshot: Option<AgentSessionSnapshot>,
    active_turn_id: Option<String>,
    last_turn_id: Option<String>,
    completed_turn_ids: VecDeque<String>,
}

impl AgentSessionReducer {
    pub fn new(session_id: String) -> Option<Self> {
        if !valid_identifier(&session_id, MAX_SESSION_ID_BYTES) {
            return None;
        }
        Some(Self {
            session_id,
            snapshot: None,
            active_turn_id: None,
            last_turn_id: None,
            completed_turn_ids: VecDeque::new(),
        })
    }

    pub fn apply(&mut self, event: AgentSessionEvent) -> bool {
        match event {
            AgentSessionEvent::TurnStarted {
                session_id,
                turn_id,
                provider,
                observed_at_ms,
            } => {
                if !self.accepts_event(&session_id, observed_at_ms)
                    || !valid_identifier(&turn_id, MAX_TURN_ID_BYTES)
                    || provider
                        .as_deref()
                        .is_some_and(|value| !valid_identifier(value, MAX_PROVIDER_BYTES))
                {
                    return false;
                }
                if self.completed_turn_ids.contains(&turn_id) {
                    return false;
                }

                let current_provider = provider.or_else(|| {
                    self.snapshot
                        .as_ref()
                        .and_then(|snapshot| snapshot.provider.clone())
                });
                self.active_turn_id = Some(turn_id.clone());
                self.last_turn_id = Some(turn_id);
                self.snapshot = Some(AgentSessionSnapshot {
                    source: AgentStatusSource::Hermes,
                    session_id: self.session_id.clone(),
                    provider: current_provider,
                    status: AgentSessionStatus::Working,
                    quality: AgentStatusQuality::Observed,
                    observed_at_ms,
                });
                true
            }
            AgentSessionEvent::TurnEnded {
                session_id,
                turn_id,
                completed,
                failed,
                interrupted,
                observed_at_ms,
            } => {
                if !self.accepts_event(&session_id, observed_at_ms) {
                    return false;
                }

                let Some(terminal_turn_id) = turn_id else {
                    return false;
                };
                if !valid_identifier(&terminal_turn_id, MAX_TURN_ID_BYTES)
                    || self.completed_turn_ids.contains(&terminal_turn_id)
                {
                    return false;
                }

                if let Some(active_turn_id) = self.active_turn_id.as_deref() {
                    if terminal_turn_id != active_turn_id {
                        return false;
                    }
                } else if self
                    .last_turn_id
                    .as_deref()
                    .is_some_and(|last_turn_id| last_turn_id != terminal_turn_id)
                {
                    return false;
                }

                let status = if interrupted {
                    AgentSessionStatus::Cancelled
                } else if failed {
                    AgentSessionStatus::Failed
                } else if completed {
                    // Hermes `on_session_end.completed` ends one turn, not the user task.
                    AgentSessionStatus::Waiting
                } else {
                    AgentSessionStatus::Unknown
                };
                let provider = self
                    .snapshot
                    .as_ref()
                    .and_then(|snapshot| snapshot.provider.clone());
                self.active_turn_id = None;
                self.last_turn_id = Some(terminal_turn_id.clone());
                self.remember_completed_turn(terminal_turn_id);
                self.snapshot = Some(AgentSessionSnapshot {
                    source: AgentStatusSource::Hermes,
                    session_id: self.session_id.clone(),
                    provider,
                    status,
                    quality: AgentStatusQuality::Observed,
                    observed_at_ms,
                });
                true
            }
        }
    }

    pub fn snapshot(&self, now_ms: i64, stale_after_ms: u64) -> Option<AgentSessionSnapshot> {
        let mut snapshot = self.snapshot.clone()?;
        if now_ms >= snapshot.observed_at_ms
            && (now_ms - snapshot.observed_at_ms) as u64 >= stale_after_ms
        {
            snapshot.status = AgentSessionStatus::Unknown;
            snapshot.quality = AgentStatusQuality::Stale;
        }
        Some(snapshot)
    }

    fn accepts_event(&self, session_id: &str, observed_at_ms: i64) -> bool {
        if session_id != self.session_id || observed_at_ms < 0 {
            return false;
        }
        self.snapshot
            .as_ref()
            .is_none_or(|snapshot| observed_at_ms >= snapshot.observed_at_ms)
    }

    fn remember_completed_turn(&mut self, turn_id: String) {
        if self.completed_turn_ids.len() == MAX_REMEMBERED_TURN_IDS {
            self.completed_turn_ids.pop_front();
        }
        self.completed_turn_ids.push_back(turn_id);
    }
}

fn valid_identifier(value: &str, max_bytes: usize) -> bool {
    !value.is_empty() && value.len() <= max_bytes && !value.chars().any(char::is_control)
}

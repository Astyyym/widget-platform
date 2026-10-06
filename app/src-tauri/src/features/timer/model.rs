use serde::{Deserialize, Serialize};

pub const TIMER_SCHEMA_VERSION: u8 = 1;
pub const MIN_TIMER_DURATION_MS: i64 = 1_000;
pub const MAX_TIMER_DURATION_MS: i64 = 7 * 24 * 60 * 60 * 1000;
pub const CLOCK_ROLLBACK_TOLERANCE_MS: i64 = 60 * 1000;
pub(super) const MAX_ACTION_ID_CHARS: usize = 128;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TimerPhase {
    Focus,
    Break,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TimerStateKind {
    Idle,
    Running,
    Paused,
    Completed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimerSnapshot {
    pub schema_version: u8,
    pub revision: u64,
    pub instance_id: String,
    pub phase: TimerPhase,
    pub state: TimerStateKind,
    pub duration_ms: i64,
    pub remaining_ms: i64,
    pub deadline_utc: Option<i64>,
    pub generation: u64,
    pub completion_id: Option<String>,
    pub clock_anomaly: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl TimerError {
    pub fn validation(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable: false,
        }
    }

    pub fn storage_unavailable() -> Self {
        Self {
            code: "storage_unavailable".into(),
            message: "计时器存储失败，请重试；未确认的状态不会标记为已保存。".into(),
            retryable: true,
        }
    }

    pub fn data_directory_unavailable() -> Self {
        Self {
            code: "storage_unavailable".into(),
            message: "计时器数据目录不可用；现有计时数据已保留。".into(),
            retryable: true,
        }
    }

    pub fn unsupported_schema() -> Self {
        Self {
            code: "storage_schema_unsupported".into(),
            message: "计时器数据库版本不受支持；原数据库已保留。".into(),
            retryable: false,
        }
    }
}

impl From<crate::storage::sqlite::StorageError> for TimerError {
    fn from(error: crate::storage::sqlite::StorageError) -> Self {
        match error {
            crate::storage::sqlite::StorageError::UnsupportedSchema => Self::unsupported_schema(),
            _ => Self::storage_unavailable(),
        }
    }
}

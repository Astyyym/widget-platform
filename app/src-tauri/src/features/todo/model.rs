use serde::{Deserialize, Serialize};

pub const TODO_SCHEMA_VERSION: u8 = 1;
pub const MAX_TODO_TEXT_CHARS: usize = 2000;
pub(super) const MAX_ACTION_ID_CHARS: usize = 128;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TodoItem {
    pub id: String,
    pub text: String,
    pub completed: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub priority_order: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TodoSnapshot {
    pub schema_version: u8,
    pub revision: u64,
    pub instance_id: String,
    pub items: Vec<TodoItem>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl TodoError {
    pub fn validation(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable: false,
        }
    }

    pub fn data_directory_unavailable() -> Self {
        Self {
            code: "storage_unavailable".into(),
            message: "待办数据目录不可用；现有数据已保留。".into(),
            retryable: true,
        }
    }

    pub fn storage_unavailable() -> Self {
        Self {
            code: "storage_unavailable".into(),
            message: "待办存储失败，请重试；未确认的数据不会标记为已保存。".into(),
            retryable: true,
        }
    }

    pub fn unsupported_schema() -> Self {
        Self {
            code: "storage_schema_unsupported".into(),
            message: "待办数据库版本不受支持；原数据库已保留。".into(),
            retryable: false,
        }
    }
}

impl From<crate::storage::sqlite::StorageError> for TodoError {
    fn from(error: crate::storage::sqlite::StorageError) -> Self {
        match error {
            crate::storage::sqlite::StorageError::UnsupportedSchema => Self::unsupported_schema(),
            _ => Self::storage_unavailable(),
        }
    }
}

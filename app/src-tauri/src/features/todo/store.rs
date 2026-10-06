use super::model::{
    TodoError, TodoItem, TodoSnapshot, MAX_ACTION_ID_CHARS, MAX_TODO_TEXT_CHARS,
    TODO_SCHEMA_VERSION,
};
use crate::storage::sqlite::{Migration, SqliteDatabase, StorageError};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const TODO_MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    sql: include_str!("../../../migrations/0001_todos.sql"),
}];
static ID_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, PartialEq)]
pub(super) struct TodoMutation {
    pub snapshot: TodoSnapshot,
    pub changed: bool,
}

pub struct TodoState {
    store: Option<TodoStore>,
    unavailable: Option<TodoError>,
}

impl TodoState {
    pub fn open(path: PathBuf, instance_id: String) -> Self {
        match TodoStore::open(path, instance_id) {
            Ok(store) => Self {
                store: Some(store),
                unavailable: None,
            },
            Err(error) => Self::unavailable(error),
        }
    }

    pub fn unavailable(error: TodoError) -> Self {
        Self {
            store: None,
            unavailable: Some(error),
        }
    }

    pub(super) fn store(&self) -> Result<&TodoStore, TodoError> {
        self.store.as_ref().ok_or_else(|| {
            self.unavailable
                .clone()
                .unwrap_or_else(TodoError::storage_unavailable)
        })
    }

    pub(super) fn get_snapshot(&self) -> Result<TodoSnapshot, TodoError> {
        self.store()?.get_snapshot()
    }

    pub(super) fn add(&self, action_id: &str, text: &str) -> Result<TodoMutation, TodoError> {
        self.store()?.add(action_id, text)
    }

    pub(super) fn set_completed(
        &self,
        action_id: &str,
        id: &str,
        completed: bool,
    ) -> Result<TodoMutation, TodoError> {
        self.store()?.set_completed(action_id, id, completed)
    }

    pub(super) fn delete(&self, action_id: &str, id: &str) -> Result<TodoMutation, TodoError> {
        self.store()?.delete(action_id, id)
    }

    pub(super) fn reorder(
        &self,
        action_id: &str,
        ordered_ids: &[String],
    ) -> Result<TodoMutation, TodoError> {
        self.store()?.reorder(action_id, ordered_ids)
    }
}

pub(super) struct TodoStore {
    pub(super) database: SqliteDatabase,
    instance_id: String,
}

impl TodoStore {
    fn open(path: PathBuf, instance_id: String) -> Result<Self, TodoError> {
        let database =
            SqliteDatabase::open(&path, TODO_MIGRATIONS).map_err(|error| match error {
                StorageError::UnsupportedSchema => TodoError::unsupported_schema(),
                _ => TodoError::storage_unavailable(),
            })?;
        Ok(Self {
            database,
            instance_id,
        })
    }

    fn get_snapshot(&self) -> Result<TodoSnapshot, TodoError> {
        self.database
            .with_connection(|connection| snapshot_from_connection(connection, &self.instance_id))
    }

    fn add(&self, action_id: &str, text: &str) -> Result<TodoMutation, TodoError> {
        validate_action_id(action_id)?;
        let normalized = text.trim();
        if normalized.is_empty() {
            return Err(TodoError::validation(
                "todo_text_empty",
                "待办内容不能为空。",
            ));
        }
        if normalized.chars().count() > MAX_TODO_TEXT_CHARS {
            return Err(TodoError::validation(
                "todo_text_too_long",
                "待办内容不能超过 2000 个字符。",
            ));
        }
        let normalized = normalized.to_owned();
        self.mutate(action_id, move |transaction, now| {
            let next_order: i64 = transaction
                .query_row(
                    "SELECT COALESCE(MAX(priority_order), -1) + 1 FROM todo_items",
                    [],
                    |row| row.get(0),
                )
                .map_err(|_| TodoError::storage_unavailable())?;
            transaction
                .execute(
                    "INSERT INTO todo_items(id, text, completed, created_at, updated_at, priority_order)
                     VALUES (?1, ?2, 0, ?3, ?3, ?4)",
                    params![new_todo_id(), normalized, now, next_order],
                )
                .map_err(|_| TodoError::storage_unavailable())?;
            Ok(true)
        })
    }

    fn set_completed(
        &self,
        action_id: &str,
        id: &str,
        completed: bool,
    ) -> Result<TodoMutation, TodoError> {
        validate_action_id(action_id)?;
        validate_todo_id(id)?;
        let id = id.to_owned();
        self.mutate(action_id, move |transaction, now| {
            let current: Option<(bool, i64)> = transaction
                .query_row(
                    "SELECT completed, updated_at FROM todo_items WHERE id = ?1",
                    [&id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(|_| TodoError::storage_unavailable())?;
            let (current_completed, updated_at) = current.ok_or_else(|| {
                TodoError::validation("todo_not_found", "待办已不存在，请刷新列表。")
            })?;
            if current_completed == completed {
                return Ok(false);
            }
            transaction
                .execute(
                    "UPDATE todo_items SET completed = ?1, updated_at = ?2 WHERE id = ?3",
                    params![completed, now.max(updated_at.saturating_add(1)), id],
                )
                .map_err(|_| TodoError::storage_unavailable())?;
            Ok(true)
        })
    }

    fn delete(&self, action_id: &str, id: &str) -> Result<TodoMutation, TodoError> {
        validate_action_id(action_id)?;
        validate_todo_id(id)?;
        let id = id.to_owned();
        self.mutate(action_id, move |transaction, _| {
            let deleted = transaction
                .execute("DELETE FROM todo_items WHERE id = ?1", [&id])
                .map_err(|_| TodoError::storage_unavailable())?;
            if deleted == 0 {
                return Err(TodoError::validation(
                    "todo_not_found",
                    "待办已不存在，请刷新列表。",
                ));
            }
            Ok(true)
        })
    }

    fn reorder(&self, action_id: &str, ordered_ids: &[String]) -> Result<TodoMutation, TodoError> {
        validate_action_id(action_id)?;
        let ordered_ids = ordered_ids.to_vec();
        self.mutate(action_id, move |transaction, now| {
            let current = todo_ids_in_order(transaction)?;
            let requested_set = ordered_ids.iter().collect::<HashSet<_>>();
            let current_set = current.iter().collect::<HashSet<_>>();
            if requested_set.len() != ordered_ids.len()
                || ordered_ids.len() != current.len()
                || requested_set != current_set
            {
                return Err(TodoError::validation(
                    "todo_order_invalid",
                    "排序列表已过期或包含重复项；请刷新后重试。",
                ));
            }
            if current == ordered_ids {
                return Ok(false);
            }
            let mut statement = transaction
                .prepare("UPDATE todo_items SET priority_order = ?1, updated_at = ?2 WHERE id = ?3")
                .map_err(|_| TodoError::storage_unavailable())?;
            for (position, id) in ordered_ids.iter().enumerate() {
                statement
                    .execute(params![position as i64, now, id])
                    .map_err(|_| TodoError::storage_unavailable())?;
            }
            Ok(true)
        })
    }

    fn mutate<F>(&self, action_id: &str, operation: F) -> Result<TodoMutation, TodoError>
    where
        F: FnOnce(&Transaction<'_>, i64) -> Result<bool, TodoError>,
    {
        self.database.with_connection(|connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|_| TodoError::storage_unavailable())?;
            let previous: Option<i64> = transaction
                .query_row(
                    "SELECT 1 FROM todo_actions WHERE action_id = ?1",
                    [action_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|_| TodoError::storage_unavailable())?;
            if previous.is_some() {
                let snapshot = snapshot_from_connection(&transaction, &self.instance_id)?;
                transaction
                    .commit()
                    .map_err(|_| TodoError::storage_unavailable())?;
                return Ok(TodoMutation {
                    snapshot,
                    changed: false,
                });
            }

            let changed = operation(&transaction, current_time_ms())?;
            if changed {
                transaction
                    .execute(
                        "UPDATE todo_meta SET revision = revision + 1 WHERE singleton = 1 AND revision < 9223372036854775807",
                        [],
                    )
                    .map_err(|_| TodoError::storage_unavailable())?;
                let revision: i64 = transaction
                    .query_row(
                        "SELECT revision FROM todo_meta WHERE singleton = 1",
                        [],
                        |row| row.get(0),
                    )
                    .map_err(|_| TodoError::storage_unavailable())?;
                if revision == i64::MAX {
                    return Err(TodoError::storage_unavailable());
                }
            }
            transaction
                .execute(
                    "INSERT INTO todo_actions(action_id, created_at) VALUES (?1, ?2)",
                    params![action_id, current_time_ms()],
                )
                .map_err(|_| TodoError::storage_unavailable())?;
            let snapshot = snapshot_from_connection(&transaction, &self.instance_id)?;
            transaction
                .commit()
                .map_err(|_| TodoError::storage_unavailable())?;
            Ok(TodoMutation { snapshot, changed })
        })
    }
}

fn validate_action_id(action_id: &str) -> Result<(), TodoError> {
    let length = action_id.chars().count();
    if length == 0 || length > MAX_ACTION_ID_CHARS {
        return Err(TodoError::validation(
            "action_id_invalid",
            "操作标识无效，请重新提交。",
        ));
    }
    Ok(())
}

fn validate_todo_id(id: &str) -> Result<(), TodoError> {
    if id.trim().is_empty() || id.chars().count() > 256 {
        return Err(TodoError::validation(
            "todo_id_invalid",
            "待办标识无效，请刷新列表。",
        ));
    }
    Ok(())
}

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn new_todo_id() -> String {
    let sequence = ID_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let nanoseconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("todo-{}-{nanoseconds}-{sequence}", std::process::id(),)
}

fn todo_ids_in_order(connection: &Connection) -> Result<Vec<String>, TodoError> {
    let mut statement = connection
        .prepare("SELECT id FROM todo_items ORDER BY priority_order, created_at, id")
        .map_err(|_| TodoError::storage_unavailable())?;
    let ids = statement
        .query_map([], |row| row.get(0))
        .map_err(|_| TodoError::storage_unavailable())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|_| TodoError::storage_unavailable());
    ids
}

fn snapshot_from_connection(
    connection: &Connection,
    instance_id: &str,
) -> Result<TodoSnapshot, TodoError> {
    let revision: i64 = connection
        .query_row(
            "SELECT revision FROM todo_meta WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|_| TodoError::storage_unavailable())?;
    let mut statement = connection
        .prepare(
            "SELECT id, text, completed, created_at, updated_at, priority_order
             FROM todo_items ORDER BY priority_order, created_at, id",
        )
        .map_err(|_| TodoError::storage_unavailable())?;
    let items = statement
        .query_map([], |row| {
            Ok(TodoItem {
                id: row.get(0)?,
                text: row.get(1)?,
                completed: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                priority_order: row.get(5)?,
            })
        })
        .map_err(|_| TodoError::storage_unavailable())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| TodoError::storage_unavailable())?;
    Ok(TodoSnapshot {
        schema_version: TODO_SCHEMA_VERSION,
        revision: revision as u64,
        instance_id: instance_id.to_owned(),
        items,
    })
}

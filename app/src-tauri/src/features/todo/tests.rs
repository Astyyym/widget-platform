use super::model::{TodoError, MAX_TODO_TEXT_CHARS};
use super::store::TodoState;
use crate::storage::sqlite::{Migration, SqliteDatabase, StorageError};
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "widget-platform-g3-a-{}-{sequence}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create isolated test directory");
        Self(path)
    }

    fn database(&self) -> PathBuf {
        self.0.join("todo.sqlite3")
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn state(directory: &TestDirectory, instance_id: &str) -> TodoState {
    TodoState::open(directory.database(), instance_id.into())
}

#[test]
fn todo_add_trims_text_and_persists_across_reopen() {
    let directory = TestDirectory::new();
    let first = state(&directory, "first-instance");
    let added = first.add("add-1", "  买牛奶  ").expect("add todo");
    assert_eq!(added.snapshot.items[0].text, "买牛奶");
    assert_eq!(added.snapshot.revision, 1);
    assert_eq!(
        added.snapshot.items[0].created_at,
        added.snapshot.items[0].updated_at
    );

    let reopened = state(&directory, "second-instance");
    let snapshot = reopened.get_snapshot().expect("reopen database");
    assert_eq!(snapshot.instance_id, "second-instance");
    assert_eq!(snapshot.revision, 1);
    assert_eq!(snapshot.items, added.snapshot.items);
}

#[test]
fn todo_validation_rejects_empty_and_over_limit_text() {
    let directory = TestDirectory::new();
    let state = state(&directory, "test-instance");
    assert_eq!(
        state.add("empty", " \t\n").unwrap_err().code,
        "todo_text_empty"
    );
    let too_long = "界".repeat(MAX_TODO_TEXT_CHARS + 1);
    assert_eq!(
        state.add("too-long", &too_long).unwrap_err().code,
        "todo_text_too_long"
    );
    assert!(state.get_snapshot().unwrap().items.is_empty());
}

#[test]
fn action_replay_is_idempotent_without_copying_todo_text_to_action_log() {
    let directory = TestDirectory::new();
    let state = state(&directory, "test-instance");
    let first = state.add("same-action", "one").unwrap();
    let replay = state.add("same-action", " one ").unwrap();
    assert_eq!(first.snapshot.items.len(), 1);
    assert_eq!(replay.snapshot.items.len(), 1);
    assert_eq!(replay.snapshot.revision, first.snapshot.revision);

    let reused = state.add("same-action", "two").unwrap();
    assert_eq!(reused.snapshot.items.len(), 1);
    assert_eq!(reused.snapshot.items[0].text, "one");
    assert_eq!(state.get_snapshot().unwrap().items.len(), 1);

    let store = state.store().unwrap();
    store
        .database
        .with_connection(|connection| -> Result<(), TodoError> {
            let request_column_count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('todo_actions') WHERE name = 'request_json'",
                    [],
                    |row| row.get(0),
                )
                .map_err(|_| TodoError::storage_unavailable())?;
            assert_eq!(request_column_count, 0);
            Ok(())
        })
        .unwrap();
}

#[test]
fn complete_delete_and_order_mutations_update_snapshot() {
    let directory = TestDirectory::new();
    let state = state(&directory, "test-instance");
    let first = state.add("add-1", "first").unwrap();
    let second = state.add("add-2", "second").unwrap();
    let first_id = first.snapshot.items[0].id.clone();
    let second_id = second.snapshot.items[1].id.clone();

    let completed = state.set_completed("complete-1", &first_id, true).unwrap();
    assert!(completed.snapshot.items[0].completed);
    assert_eq!(completed.snapshot.revision, 3);
    let unchanged = state.set_completed("complete-2", &first_id, true).unwrap();
    assert!(!unchanged.changed);
    assert_eq!(unchanged.snapshot.revision, 3);

    let reordered = state
        .reorder("reorder-1", &[second_id.clone(), first_id.clone()])
        .unwrap();
    assert_eq!(
        reordered
            .snapshot
            .items
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        vec![second_id.as_str(), first_id.as_str()]
    );
    assert_eq!(reordered.snapshot.revision, 4);

    let invalid = state
        .reorder("reorder-invalid", &[first_id.clone()])
        .unwrap_err();
    assert_eq!(invalid.code, "todo_order_invalid");
    assert_eq!(state.get_snapshot().unwrap().items.len(), 2);

    let deleted = state.delete("delete-1", &second_id).unwrap();
    assert_eq!(deleted.snapshot.items.len(), 1);
    assert_eq!(deleted.snapshot.items[0].id, first_id);
    assert_eq!(deleted.snapshot.revision, 5);
}

#[test]
fn reordered_priority_survives_database_reopen() {
    let directory = TestDirectory::new();
    let before = state(&directory, "first-instance");
    let first = before.add("add-a", "A").unwrap().snapshot.items[0]
        .id
        .clone();
    let second = before.add("add-b", "B").unwrap().snapshot.items[1]
        .id
        .clone();
    before
        .reorder("order", &[second.clone(), first.clone()])
        .unwrap();

    let after = state(&directory, "after-restart").get_snapshot().unwrap();
    assert_eq!(after.items[0].id, second);
    assert_eq!(after.items[1].id, first);
    assert_eq!(after.items[0].priority_order, 0);
    assert_eq!(after.items[1].priority_order, 1);
}

#[test]
fn failed_transaction_does_not_save_item_or_advance_revision() {
    let directory = TestDirectory::new();
    let state = state(&directory, "test-instance");
    let store = state.store().unwrap();
    store
        .database
        .with_connection(|connection| -> Result<(), TodoError> {
            connection
                .execute_batch(
                    "CREATE TRIGGER fail_action_write BEFORE INSERT ON todo_actions
                     BEGIN SELECT RAISE(ABORT, 'injected transaction failure'); END;",
                )
                .map_err(|_| TodoError::storage_unavailable())?;
            Ok(())
        })
        .unwrap();

    assert!(state.add("faulted", "must not persist").is_err());
    let snapshot = state.get_snapshot().unwrap();
    assert!(snapshot.items.is_empty());
    assert_eq!(snapshot.revision, 0);
}

#[test]
fn query_only_database_refuses_writes_without_changing_saved_state() {
    let directory = TestDirectory::new();
    let state = state(&directory, "test-instance");
    let existing = state.add("add", "saved").unwrap();
    let store = state.store().unwrap();
    store
        .database
        .with_connection(|connection| -> Result<(), TodoError> {
            connection
                .execute_batch("PRAGMA query_only = ON;")
                .map_err(|_| TodoError::storage_unavailable())?;
            Ok(())
        })
        .unwrap();

    let failure = state.add("refused", "not saved").unwrap_err();
    assert_eq!(failure.code, "storage_unavailable");
    assert!(failure.retryable);
    let snapshot = state.get_snapshot().unwrap();
    assert_eq!(snapshot.items, existing.snapshot.items);
    assert_eq!(snapshot.revision, existing.snapshot.revision);
}

#[test]
fn refused_reorder_preserves_the_saved_priority_order() {
    let directory = TestDirectory::new();
    let state = state(&directory, "test-instance");
    let added = state.add("add-a", "A").unwrap();
    let first = added.snapshot.items[0].id.clone();
    let second = state.add("add-b", "B").unwrap().snapshot.items[1]
        .id
        .clone();
    let before = state.get_snapshot().unwrap();

    state
        .store()
        .unwrap()
        .database
        .with_connection(|connection| -> Result<(), TodoError> {
            connection
                .execute_batch("PRAGMA query_only = ON;")
                .map_err(|_| TodoError::storage_unavailable())?;
            Ok(())
        })
        .unwrap();

    let error = state
        .reorder("refused-reorder", &[second, first])
        .unwrap_err();
    assert_eq!(error.code, "storage_unavailable");
    let after = state.get_snapshot().unwrap();
    assert_eq!(after.items, before.items);
    assert_eq!(after.revision, before.revision);
}

#[test]
fn failed_version_migration_rolls_back_all_schema_changes() {
    let directory = TestDirectory::new();
    let path = directory.database();
    let migrations = [
        Migration {
            version: 1,
            sql: "CREATE TABLE migration_first(id INTEGER PRIMARY KEY);",
        },
        Migration {
            version: 2,
            sql: "CREATE TABLE migration_first(id INTEGER PRIMARY KEY);",
        },
    ];
    assert!(matches!(
        SqliteDatabase::open(&path, &migrations),
        Err(StorageError::Database)
    ));

    let connection = Connection::open(path).unwrap();
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    let table_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'migration_first'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(version, 0);
    assert_eq!(table_count, 0);
}

#[test]
fn unsupported_schema_is_reported_and_database_is_retained() {
    let directory = TestDirectory::new();
    let path = directory.database();
    let connection = Connection::open(&path).unwrap();
    connection
        .pragma_update(None, "user_version", 99_i64)
        .unwrap();
    drop(connection);

    let state = TodoState::open(path.clone(), "test-instance".into());
    let error = state.get_snapshot().unwrap_err();
    assert_eq!(error.code, "storage_schema_unsupported");
    let connection = Connection::open(path).unwrap();
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 99);
}

#[test]
fn action_identifiers_must_be_present_and_bounded() {
    let directory = TestDirectory::new();
    let state = state(&directory, "test-instance");
    assert_eq!(
        state.add("", "valid").unwrap_err().code,
        "action_id_invalid"
    );
    assert_eq!(
        state.add(&"x".repeat(129), "valid").unwrap_err().code,
        "action_id_invalid"
    );
    assert!(state.get_snapshot().unwrap().items.is_empty());
}

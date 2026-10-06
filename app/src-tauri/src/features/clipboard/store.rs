use super::{
    protect_text, unprotect_text, CaptureOutcome, ClipboardEntry, ProtectedClipboardText,
    TextProtector,
};
use crate::storage::sqlite::{Migration, SqliteDatabase, StorageError};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use std::path::PathBuf;
use std::sync::Arc;

const CLIPBOARD_MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    sql: include_str!("../../../migrations/0001_clipboard.sql"),
}];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClipboardStorageError {
    Open,
    Database,
    UnsupportedSchema,
    Protection,
    CorruptData,
    InvalidMutation,
}

impl From<StorageError> for ClipboardStorageError {
    fn from(value: StorageError) -> Self {
        match value {
            StorageError::Open => Self::Open,
            StorageError::UnsupportedSchema => Self::UnsupportedSchema,
            StorageError::Database
            | StorageError::InvalidMigrations
            | StorageError::LockPoisoned => Self::Database,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredClipboardSnapshot {
    pub revision: u64,
    pub entries: Vec<ClipboardEntry>,
}

pub struct ClipboardStore {
    database: SqliteDatabase,
    protector: Arc<dyn TextProtector>,
}

impl ClipboardStore {
    pub fn open(
        path: PathBuf,
        protector: Arc<dyn TextProtector>,
    ) -> Result<Self, ClipboardStorageError> {
        let database = SqliteDatabase::open(&path, CLIPBOARD_MIGRATIONS)?;
        Ok(Self {
            database,
            protector,
        })
    }

    pub fn load_snapshot(&self) -> Result<StoredClipboardSnapshot, ClipboardStorageError> {
        self.database.with_connection(|connection| {
            let revision = read_revision(connection)?;
            let mut statement = connection
                .prepare(
                    "SELECT id, protected_version, ciphertext, created_at_ms, source_app_id, pinned, byte_len
                     FROM clipboard_entries
                     ORDER BY created_at_ms DESC, CAST(SUBSTR(id, 6) AS INTEGER) DESC",
                )
                .map_err(|_| ClipboardStorageError::Database)?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                    ))
                })
                .map_err(|_| ClipboardStorageError::Database)?;

            let mut entries = Vec::new();
            for row in rows {
                let (id, version, ciphertext, created_at_ms, source_app_id, pinned, byte_len) =
                    row.map_err(|_| ClipboardStorageError::Database)?;
                let version =
                    u8::try_from(version).map_err(|_| ClipboardStorageError::CorruptData)?;
                let created_at_ms =
                    u64::try_from(created_at_ms).map_err(|_| ClipboardStorageError::CorruptData)?;
                let byte_len =
                    usize::try_from(byte_len).map_err(|_| ClipboardStorageError::CorruptData)?;
                if id.is_empty()
                    || ciphertext.is_empty()
                    || !matches!(pinned, 0 | 1)
                    || byte_len == 0
                {
                    return Err(ClipboardStorageError::CorruptData);
                }
                let text = unprotect_text(
                    self.protector.as_ref(),
                    &ProtectedClipboardText {
                        version,
                        ciphertext,
                    },
                )
                .map_err(|_| ClipboardStorageError::CorruptData)?;
                if text.len() != byte_len || text.contains('\0') {
                    return Err(ClipboardStorageError::CorruptData);
                }
                entries.push(ClipboardEntry {
                    id,
                    text,
                    created_at_ms,
                    source_app_id,
                    pinned: pinned == 1,
                    byte_len,
                });
            }
            Ok(StoredClipboardSnapshot { revision, entries })
        })
    }

    pub fn apply_capture(
        &self,
        outcome: &CaptureOutcome,
        inserted_entry: Option<&ClipboardEntry>,
    ) -> Result<u64, ClipboardStorageError> {
        let (evicted_ids, inserted_id) = match outcome {
            CaptureOutcome::Excluded { evicted_ids, .. }
            | CaptureOutcome::Duplicate { evicted_ids, .. }
            | CaptureOutcome::CapacityExceeded { evicted_ids } => {
                if inserted_entry.is_some() {
                    return Err(ClipboardStorageError::InvalidMutation);
                }
                (evicted_ids.as_slice(), None)
            }
            CaptureOutcome::Inserted {
                entry_id,
                evicted_ids,
            } => (evicted_ids.as_slice(), Some(entry_id.as_str())),
            CaptureOutcome::Disabled | CaptureOutcome::InvalidPolicy => {
                return Err(ClipboardStorageError::InvalidMutation)
            }
        };

        let protected = match (inserted_id, inserted_entry) {
            (Some(expected_id), Some(entry)) if entry.id == expected_id => Some((
                entry,
                protect_text(self.protector.as_ref(), &entry.text)
                    .map_err(|_| ClipboardStorageError::Protection)?,
            )),
            (None, None) => None,
            _ => return Err(ClipboardStorageError::InvalidMutation),
        };

        self.database.with_connection(|connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|_| ClipboardStorageError::Database)?;
            let mut changed = false;
            for id in evicted_ids {
                changed |= transaction
                    .execute("DELETE FROM clipboard_entries WHERE id = ?1", [id])
                    .map_err(|_| ClipboardStorageError::Database)?
                    > 0;
            }
            if let Some((entry, protected)) = protected {
                transaction
                    .execute(
                        "INSERT INTO clipboard_entries(
                            id, protected_version, ciphertext, created_at_ms,
                            source_app_id, pinned, byte_len
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                        params![
                            entry.id,
                            i64::from(protected.version),
                            protected.ciphertext,
                            i64::try_from(entry.created_at_ms)
                                .map_err(|_| ClipboardStorageError::InvalidMutation)?,
                            entry.source_app_id,
                            i64::from(entry.pinned),
                            i64::try_from(entry.byte_len)
                                .map_err(|_| ClipboardStorageError::InvalidMutation)?,
                        ],
                    )
                    .map_err(|_| ClipboardStorageError::Database)?;
                changed = true;
            }
            if changed {
                increment_revision(&transaction)?;
            }
            let revision = read_revision(&transaction)?;
            transaction
                .commit()
                .map_err(|_| ClipboardStorageError::Database)?;
            Ok(revision)
        })
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<u64, ClipboardStorageError> {
        self.apply_mutation(&[], Some((id, pinned)))
    }

    pub fn apply_mutation(
        &self,
        deleted_ids: &[String],
        pin: Option<(&str, bool)>,
    ) -> Result<u64, ClipboardStorageError> {
        self.database.with_connection(|connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|_| ClipboardStorageError::Database)?;
            let mut changed = false;
            for id in deleted_ids {
                changed |= transaction
                    .execute("DELETE FROM clipboard_entries WHERE id = ?1", [id])
                    .map_err(|_| ClipboardStorageError::Database)?
                    > 0;
            }
            if let Some((id, pinned)) = pin {
                changed |= transaction
                    .execute(
                        "UPDATE clipboard_entries SET pinned = ?1 WHERE id = ?2 AND pinned <> ?1",
                        params![i64::from(pinned), id],
                    )
                    .map_err(|_| ClipboardStorageError::Database)?
                    > 0;
            }
            if changed {
                increment_revision(&transaction)?;
            }
            let revision = read_revision(&transaction)?;
            transaction
                .commit()
                .map_err(|_| ClipboardStorageError::Database)?;
            Ok(revision)
        })
    }

    pub fn delete_ids(&self, ids: &[String]) -> Result<u64, ClipboardStorageError> {
        self.apply_mutation(ids, None)
    }
}

fn read_revision(connection: &rusqlite::Connection) -> Result<u64, ClipboardStorageError> {
    let revision: Option<i64> = connection
        .query_row(
            "SELECT revision FROM clipboard_meta WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| ClipboardStorageError::Database)?;
    let revision = revision.ok_or(ClipboardStorageError::CorruptData)?;
    u64::try_from(revision).map_err(|_| ClipboardStorageError::CorruptData)
}

fn increment_revision(connection: &rusqlite::Connection) -> Result<(), ClipboardStorageError> {
    let updated = connection
        .execute(
            "UPDATE clipboard_meta
             SET revision = revision + 1
             WHERE singleton = 1 AND revision < 9223372036854775807",
            [],
        )
        .map_err(|_| ClipboardStorageError::Database)?;
    if updated != 1 {
        return Err(ClipboardStorageError::Database);
    }
    Ok(())
}

use rusqlite::{Connection, TransactionBehavior};
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

#[derive(Clone, Copy)]
pub struct Migration {
    pub version: i64,
    pub sql: &'static str,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StorageError {
    Open,
    Database,
    UnsupportedSchema,
    InvalidMigrations,
    LockPoisoned,
}

pub struct SqliteDatabase {
    connection: Mutex<Connection>,
}

impl SqliteDatabase {
    pub fn open(path: &Path, migrations: &[Migration]) -> Result<Self, StorageError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|_| StorageError::Open)?;
        }
        let mut connection = Connection::open(path).map_err(|_| StorageError::Open)?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|_| StorageError::Database)?;
        Self::apply_migrations(&mut connection, migrations)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub(crate) fn with_connection<T, E>(
        &self,
        operation: impl FnOnce(&mut Connection) -> Result<T, E>,
    ) -> Result<T, E>
    where
        E: From<StorageError>,
    {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| E::from(StorageError::LockPoisoned))?;
        operation(&mut connection)
    }

    fn apply_migrations(
        connection: &mut Connection,
        migrations: &[Migration],
    ) -> Result<(), StorageError> {
        if migrations
            .windows(2)
            .any(|pair| pair[0].version >= pair[1].version)
            || migrations.iter().any(|migration| migration.version <= 0)
        {
            return Err(StorageError::InvalidMigrations);
        }

        let current_version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|_| StorageError::Database)?;
        let latest_version = migrations.last().map_or(0, |migration| migration.version);
        if current_version > latest_version {
            return Err(StorageError::UnsupportedSchema);
        }
        if current_version == latest_version {
            return Ok(());
        }

        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StorageError::Database)?;
        let mut expected_version = current_version + 1;
        for migration in migrations
            .iter()
            .filter(|migration| migration.version > current_version)
        {
            if migration.version != expected_version {
                return Err(StorageError::InvalidMigrations);
            }
            transaction
                .execute_batch(migration.sql)
                .map_err(|_| StorageError::Database)?;
            transaction
                .pragma_update(None, "user_version", migration.version)
                .map_err(|_| StorageError::Database)?;
            expected_version += 1;
        }
        transaction.commit().map_err(|_| StorageError::Database)
    }
}

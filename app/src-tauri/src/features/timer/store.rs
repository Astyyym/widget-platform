use super::model::{
    TimerError, TimerPhase, TimerSnapshot, TimerStateKind, CLOCK_ROLLBACK_TOLERANCE_MS,
    MAX_ACTION_ID_CHARS, MAX_TIMER_DURATION_MS, MIN_TIMER_DURATION_MS, TIMER_SCHEMA_VERSION,
};
use crate::storage::sqlite::{Migration, SqliteDatabase, StorageError};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

const TIMER_MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    sql: include_str!("../../../migrations/0001_timer.sql"),
}];

pub trait Clock: Send + Sync {
    fn now_ms(&self) -> i64;
}

#[derive(Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(i64::MAX as u128) as i64
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct TimerMutation {
    pub snapshot: TimerSnapshot,
    pub changed: bool,
}

pub struct TimerState {
    store: Option<TimerStore>,
    unavailable: Option<TimerError>,
}

impl TimerState {
    pub fn open(path: PathBuf, instance_id: String) -> Self {
        Self::open_with_clock(path, instance_id, Arc::new(SystemClock))
    }

    pub(crate) fn open_with_clock(
        path: PathBuf,
        instance_id: String,
        clock: Arc<dyn Clock>,
    ) -> Self {
        match TimerStore::open(path, instance_id, clock) {
            Ok(store) => Self {
                store: Some(store),
                unavailable: None,
            },
            Err(error) => Self::unavailable(error),
        }
    }

    pub fn unavailable(error: TimerError) -> Self {
        Self {
            store: None,
            unavailable: Some(error),
        }
    }

    pub(super) fn store(&self) -> Result<&TimerStore, TimerError> {
        self.store.as_ref().ok_or_else(|| {
            self.unavailable
                .clone()
                .unwrap_or_else(TimerError::storage_unavailable)
        })
    }

    pub(super) fn get_snapshot(&self) -> Result<TimerSnapshot, TimerError> {
        self.store()?.get_snapshot()
    }

    pub(super) fn start(
        &self,
        action_id: &str,
        phase: TimerPhase,
        duration_ms: i64,
    ) -> Result<TimerMutation, TimerError> {
        self.store()?.start(action_id, phase, duration_ms)
    }

    pub(super) fn pause(&self, action_id: &str) -> Result<TimerMutation, TimerError> {
        self.store()?.pause(action_id)
    }

    pub(super) fn resume(&self, action_id: &str) -> Result<TimerMutation, TimerError> {
        self.store()?.resume(action_id)
    }

    pub(super) fn reset(
        &self,
        action_id: &str,
        duration_ms: Option<i64>,
    ) -> Result<TimerMutation, TimerError> {
        self.store()?.reset(action_id, duration_ms)
    }

    pub(super) fn expire(
        &self,
        action_id: &str,
        generation: u64,
    ) -> Result<TimerMutation, TimerError> {
        self.store()?.expire(action_id, generation)
    }
}

pub(super) struct TimerStore {
    pub(super) database: SqliteDatabase,
    instance_id: String,
    clock: Arc<dyn Clock>,
}

impl TimerStore {
    fn open(path: PathBuf, instance_id: String, clock: Arc<dyn Clock>) -> Result<Self, TimerError> {
        let database =
            SqliteDatabase::open(&path, TIMER_MIGRATIONS).map_err(|error| match error {
                StorageError::UnsupportedSchema => TimerError::unsupported_schema(),
                _ => TimerError::storage_unavailable(),
            })?;
        Ok(Self {
            database,
            instance_id,
            clock,
        })
    }

    fn get_snapshot(&self) -> Result<TimerSnapshot, TimerError> {
        let now = self.clock.now_ms();
        self.database.with_connection(|connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|_| TimerError::storage_unavailable())?;
            observe_and_reconcile(&transaction, now)?;
            let snapshot = snapshot_from_connection(&transaction, &self.instance_id, now)?;
            transaction
                .commit()
                .map_err(|_| TimerError::storage_unavailable())?;
            Ok(snapshot)
        })
    }

    fn start(
        &self,
        action_id: &str,
        phase: TimerPhase,
        duration_ms: i64,
    ) -> Result<TimerMutation, TimerError> {
        validate_action_id(action_id)?;
        validate_duration(duration_ms)?;
        self.mutate(action_id, move |transaction, now| {
            let state = read_state(transaction)?;
            if matches!(state, TimerStateKind::Running | TimerStateKind::Paused) {
                return Err(TimerError::validation(
                    "timer_state_invalid",
                    "当前计时尚未结束；请先暂停或重置。",
                ));
            }
            let generation = next_generation(transaction)?;
            let deadline = checked_deadline(now, duration_ms)?;
            transaction
                .execute(
                    "UPDATE timer_state SET phase = ?1, state = 'running', duration_ms = ?2,
                     remaining_ms = ?2, deadline_utc = ?3, generation = ?4,
                     completion_id = NULL, clock_anomaly = 0 WHERE singleton = 1",
                    params![phase_as_str(phase), duration_ms, deadline, generation],
                )
                .map_err(|_| TimerError::storage_unavailable())?;
            Ok(true)
        })
    }

    fn pause(&self, action_id: &str) -> Result<TimerMutation, TimerError> {
        validate_action_id(action_id)?;
        self.mutate(action_id, move |transaction, now| {
            let (state, deadline, stored_remaining, _, anomaly) = read_runtime(transaction)?;
            if state != TimerStateKind::Running {
                return Err(TimerError::validation(
                    "timer_state_invalid",
                    "只有运行中的计时可以暂停。",
                ));
            }
            let deadline = deadline.ok_or_else(TimerError::storage_unavailable)?;
            let remaining = if anomaly {
                stored_remaining
            } else {
                deadline.saturating_sub(now).max(0)
            };
            if remaining == 0 {
                return Ok(false);
            }
            transaction
                .execute(
                    "UPDATE timer_state SET state = 'paused', remaining_ms = ?1,
                     deadline_utc = NULL WHERE singleton = 1",
                    [remaining],
                )
                .map_err(|_| TimerError::storage_unavailable())?;
            Ok(true)
        })
    }

    fn resume(&self, action_id: &str) -> Result<TimerMutation, TimerError> {
        validate_action_id(action_id)?;
        self.mutate(action_id, move |transaction, now| {
            let (state, _, remaining, _, _) = read_runtime(transaction)?;
            if state != TimerStateKind::Paused || remaining <= 0 {
                return Err(TimerError::validation(
                    "timer_state_invalid",
                    "只有已暂停且仍有剩余时间的计时可以继续。",
                ));
            }
            let generation = next_generation(transaction)?;
            let deadline = checked_deadline(now, remaining)?;
            transaction
                .execute(
                    "UPDATE timer_state SET state = 'running', deadline_utc = ?1,
                     generation = ?2, clock_anomaly = 0, last_observed_utc = ?3 WHERE singleton = 1",
                    params![deadline, generation, now],
                )
                .map_err(|_| TimerError::storage_unavailable())?;
            Ok(true)
        })
    }

    fn reset(
        &self,
        action_id: &str,
        duration_ms: Option<i64>,
    ) -> Result<TimerMutation, TimerError> {
        validate_action_id(action_id)?;
        self.mutate(action_id, move |transaction, _| {
            let (_, _, current_duration, _, _) = read_runtime(transaction)?;
            let duration = duration_ms.unwrap_or(current_duration);
            validate_duration(duration)?;
            let generation = next_generation(transaction)?;
            transaction
                .execute(
                    "UPDATE timer_state SET state = 'idle', duration_ms = ?1,
                     remaining_ms = ?1, deadline_utc = NULL, generation = ?2,
                     completion_id = NULL, clock_anomaly = 0 WHERE singleton = 1",
                    params![duration, generation],
                )
                .map_err(|_| TimerError::storage_unavailable())?;
            Ok(true)
        })
    }

    fn expire(&self, action_id: &str, generation: u64) -> Result<TimerMutation, TimerError> {
        validate_action_id(action_id)?;
        self.mutate(action_id, move |transaction, now| {
            let (state, deadline, _, current_generation, _) = read_runtime(transaction)?;
            if state != TimerStateKind::Running
                || current_generation != generation
                || deadline.map_or(true, |value| value > now)
            {
                return Ok(false);
            }
            let completion_id = completion_id(current_generation, now);
            transaction
                .execute(
                    "UPDATE timer_state SET state = 'completed', remaining_ms = 0,
                     deadline_utc = NULL, completion_id = ?1 WHERE singleton = 1",
                    [&completion_id],
                )
                .map_err(|_| TimerError::storage_unavailable())?;
            Ok(true)
        })
    }

    fn mutate<F>(&self, action_id: &str, operation: F) -> Result<TimerMutation, TimerError>
    where
        F: FnOnce(&Transaction<'_>, i64) -> Result<bool, TimerError>,
    {
        self.database.with_connection(|connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|_| TimerError::storage_unavailable())?;
            let now = self.clock.now_ms();
            observe_and_reconcile(&transaction, now)?;
            let previous: Option<i64> = transaction
                .query_row(
                    "SELECT 1 FROM timer_actions WHERE action_id = ?1",
                    [action_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|_| TimerError::storage_unavailable())?;
            if previous.is_some() {
                let snapshot = snapshot_from_connection(&transaction, &self.instance_id, now)?;
                transaction
                    .commit()
                    .map_err(|_| TimerError::storage_unavailable())?;
                return Ok(TimerMutation {
                    snapshot,
                    changed: false,
                });
            }

            let changed = operation(&transaction, now)?;
            if changed {
                bump_revision(&transaction)?;
            }
            transaction
                .execute(
                    "INSERT INTO timer_actions(action_id, created_at) VALUES (?1, ?2)",
                    params![action_id, now],
                )
                .map_err(|_| TimerError::storage_unavailable())?;
            let snapshot = snapshot_from_connection(&transaction, &self.instance_id, now)?;
            transaction
                .commit()
                .map_err(|_| TimerError::storage_unavailable())?;
            Ok(TimerMutation { snapshot, changed })
        })
    }
}

fn validate_action_id(action_id: &str) -> Result<(), TimerError> {
    let length = action_id.chars().count();
    if length == 0 || length > MAX_ACTION_ID_CHARS {
        return Err(TimerError::validation(
            "action_id_invalid",
            "操作标识无效，请重新提交。",
        ));
    }
    Ok(())
}

fn validate_duration(duration_ms: i64) -> Result<(), TimerError> {
    if !(MIN_TIMER_DURATION_MS..=MAX_TIMER_DURATION_MS).contains(&duration_ms) {
        return Err(TimerError::validation(
            "timer_duration_invalid",
            "计时长度必须在 1 秒到 7 天之间。",
        ));
    }
    Ok(())
}

fn checked_deadline(now: i64, duration_ms: i64) -> Result<i64, TimerError> {
    now.checked_add(duration_ms).ok_or_else(|| {
        TimerError::validation("timer_clock_invalid", "系统时钟超出可支持的计时范围。")
    })
}

fn phase_as_str(phase: TimerPhase) -> &'static str {
    match phase {
        TimerPhase::Focus => "focus",
        TimerPhase::Break => "break",
    }
}

fn phase_from_str(value: &str) -> Result<TimerPhase, TimerError> {
    match value {
        "focus" => Ok(TimerPhase::Focus),
        "break" => Ok(TimerPhase::Break),
        _ => Err(TimerError::storage_unavailable()),
    }
}

fn state_as_str(state: TimerStateKind) -> &'static str {
    match state {
        TimerStateKind::Idle => "idle",
        TimerStateKind::Running => "running",
        TimerStateKind::Paused => "paused",
        TimerStateKind::Completed => "completed",
    }
}

fn state_from_str(value: &str) -> Result<TimerStateKind, TimerError> {
    match value {
        "idle" => Ok(TimerStateKind::Idle),
        "running" => Ok(TimerStateKind::Running),
        "paused" => Ok(TimerStateKind::Paused),
        "completed" => Ok(TimerStateKind::Completed),
        _ => Err(TimerError::storage_unavailable()),
    }
}

fn read_state(transaction: &Transaction<'_>) -> Result<TimerStateKind, TimerError> {
    transaction
        .query_row(
            "SELECT state FROM timer_state WHERE singleton = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| TimerError::storage_unavailable())
        .and_then(|value| state_from_str(&value))
}

fn read_runtime(
    transaction: &Transaction<'_>,
) -> Result<(TimerStateKind, Option<i64>, i64, u64, bool), TimerError> {
    transaction
        .query_row(
            "SELECT state, deadline_utc, remaining_ms, generation, clock_anomaly
             FROM timer_state WHERE singleton = 1",
            [],
            |row| {
                let state: String = row.get(0)?;
                let generation: i64 = row.get(3)?;
                Ok((
                    state,
                    row.get(1)?,
                    row.get(2)?,
                    generation,
                    row.get::<_, i64>(4)? != 0,
                ))
            },
        )
        .map_err(|_| TimerError::storage_unavailable())
        .and_then(|(state, deadline, remaining, generation, anomaly)| {
            let generation =
                u64::try_from(generation).map_err(|_| TimerError::storage_unavailable())?;
            Ok((
                state_from_str(&state)?,
                deadline,
                remaining,
                generation,
                anomaly,
            ))
        })
}

fn next_generation(transaction: &Transaction<'_>) -> Result<i64, TimerError> {
    let generation: i64 = transaction
        .query_row(
            "SELECT generation FROM timer_state WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|_| TimerError::storage_unavailable())?;
    generation
        .checked_add(1)
        .ok_or_else(TimerError::storage_unavailable)
}

fn bump_revision(transaction: &Transaction<'_>) -> Result<(), TimerError> {
    let revision: i64 = transaction
        .query_row(
            "SELECT revision FROM timer_state WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|_| TimerError::storage_unavailable())?;
    if revision == i64::MAX {
        return Err(TimerError::storage_unavailable());
    }
    transaction
        .execute(
            "UPDATE timer_state SET revision = revision + 1 WHERE singleton = 1",
            [],
        )
        .map_err(|_| TimerError::storage_unavailable())?;
    Ok(())
}

fn observe_and_reconcile(transaction: &Transaction<'_>, now: i64) -> Result<(), TimerError> {
    let (state, deadline, generation, last_observed, stored_remaining): (
        String,
        Option<i64>,
        i64,
        Option<i64>,
        i64,
    ) = transaction
        .query_row(
            "SELECT state, deadline_utc, generation, last_observed_utc, remaining_ms
             FROM timer_state WHERE singleton = 1",
            [],
            |row| {
                let state: String = row.get(0)?;
                let generation = row.get(2)?;
                let last_observed = row.get(3)?;
                Ok((state, row.get(1)?, generation, last_observed, row.get(4)?))
            },
        )
        .map_err(|_| TimerError::storage_unavailable())?;
    let rollback = last_observed
        .is_some_and(|previous| now < previous.saturating_sub(CLOCK_ROLLBACK_TOLERANCE_MS));
    let expired = state == state_as_str(TimerStateKind::Running)
        && deadline.is_some_and(|value| value <= now);
    if rollback || expired {
        if expired {
            let completion = completion_id(
                u64::try_from(generation).map_err(|_| TimerError::storage_unavailable())?,
                now,
            );
            transaction
                .execute(
                    "UPDATE timer_state SET state = 'completed', remaining_ms = 0,
                     deadline_utc = NULL, completion_id = ?1, last_observed_utc = ?2,
                     clock_anomaly = CASE WHEN ?3 THEN 1 ELSE clock_anomaly END WHERE singleton = 1",
                    params![completion, now, rollback],
                )
                .map_err(|_| TimerError::storage_unavailable())?;
        } else {
            transaction
                .execute(
                    "UPDATE timer_state SET last_observed_utc = ?1, clock_anomaly = 1 WHERE singleton = 1",
                    params![now],
                )
                .map_err(|_| TimerError::storage_unavailable())?;
        }
        bump_revision(transaction)?;
    } else if state == state_as_str(TimerStateKind::Running) {
        let remaining = deadline.map_or(stored_remaining, |value| value.saturating_sub(now).max(0));
        transaction
            .execute(
                "UPDATE timer_state SET remaining_ms = ?1, last_observed_utc = ?2 WHERE singleton = 1",
                params![remaining, now],
            )
            .map_err(|_| TimerError::storage_unavailable())?;
    } else {
        transaction
            .execute(
                "UPDATE timer_state SET last_observed_utc = ?1 WHERE singleton = 1",
                params![now],
            )
            .map_err(|_| TimerError::storage_unavailable())?;
    }
    Ok(())
}

fn snapshot_from_connection(
    connection: &Connection,
    instance_id: &str,
    now: i64,
) -> Result<TimerSnapshot, TimerError> {
    let row = connection
        .query_row(
            "SELECT phase, state, duration_ms, remaining_ms, deadline_utc, generation,
                    completion_id, revision, clock_anomaly
             FROM timer_state WHERE singleton = 1",
            [],
            |row| {
                let phase: String = row.get(0)?;
                let state: String = row.get(1)?;
                let generation: i64 = row.get(5)?;
                let revision: i64 = row.get(7)?;
                Ok((
                    phase,
                    state,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    generation,
                    row.get::<_, Option<String>>(6)?,
                    revision,
                    row.get::<_, i64>(8)? != 0,
                ))
            },
        )
        .map_err(|_| TimerError::storage_unavailable())?;
    let (_, state, _, stored_remaining, deadline, _, _, _, clock_anomaly) = &row;
    let remaining = if state == state_as_str(TimerStateKind::Running) && !clock_anomaly {
        deadline.map_or(*stored_remaining, |value| value.saturating_sub(now).max(0))
    } else {
        *stored_remaining
    };
    Ok(TimerSnapshot {
        schema_version: TIMER_SCHEMA_VERSION,
        revision: u64::try_from(row.7).map_err(|_| TimerError::storage_unavailable())?,
        instance_id: instance_id.to_owned(),
        phase: phase_from_str(&row.0)?,
        state: state_from_str(&row.1)?,
        duration_ms: row.2,
        remaining_ms: remaining,
        deadline_utc: row.4,
        generation: u64::try_from(row.5).map_err(|_| TimerError::storage_unavailable())?,
        completion_id: row.6,
        clock_anomaly: row.8,
    })
}

fn completion_id(generation: u64, now: i64) -> String {
    static COMPLETION_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let sequence = COMPLETION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("timer-completion-{generation}-{now}-{sequence}")
}

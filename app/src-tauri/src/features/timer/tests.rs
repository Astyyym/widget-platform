use super::model::TimerError;
use super::model::{TimerPhase, TimerStateKind};
use super::store::{Clock, TimerState};
use crate::storage::sqlite::StorageError;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::Arc;

static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "widget-platform-g3-c-{}-{sequence}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create isolated test directory");
        Self(path)
    }

    fn database(&self) -> PathBuf {
        self.0.join("timer.sqlite3")
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[derive(Default)]
struct FakeClock(AtomicI64);

impl FakeClock {
    fn new(now: i64) -> Arc<Self> {
        Arc::new(Self(AtomicI64::new(now)))
    }

    fn set(&self, now: i64) {
        self.0.store(now, Ordering::SeqCst);
    }
}

impl Clock for FakeClock {
    fn now_ms(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}

fn state(directory: &TestDirectory, clock: Arc<FakeClock>, instance_id: &str) -> TimerState {
    TimerState::open_with_clock(directory.database(), instance_id.into(), clock)
}

#[test]
fn start_pause_resume_and_reset_preserve_state_contract() {
    let directory = TestDirectory::new();
    let clock = FakeClock::new(1_000);
    let timer = state(&directory, clock.clone(), "first");

    let started = timer.start("start", TimerPhase::Focus, 10_000).unwrap();
    assert_eq!(started.snapshot.state, TimerStateKind::Running);
    assert_eq!(started.snapshot.remaining_ms, 10_000);
    assert_eq!(started.snapshot.deadline_utc, Some(11_000));
    assert_eq!(started.snapshot.generation, 1);

    clock.set(4_500);
    let paused = timer.pause("pause").unwrap();
    assert_eq!(paused.snapshot.state, TimerStateKind::Paused);
    assert_eq!(paused.snapshot.remaining_ms, 6_500);
    assert_eq!(paused.snapshot.deadline_utc, None);

    clock.set(20_000);
    let resumed = timer.resume("resume").unwrap();
    assert_eq!(resumed.snapshot.state, TimerStateKind::Running);
    assert_eq!(resumed.snapshot.deadline_utc, Some(26_500));
    assert_eq!(resumed.snapshot.generation, 2);

    let reset = timer.reset("reset", Some(7_000)).unwrap();
    assert_eq!(reset.snapshot.state, TimerStateKind::Idle);
    assert_eq!(reset.snapshot.remaining_ms, 7_000);
    assert_eq!(reset.snapshot.generation, 3);
    assert_eq!(reset.snapshot.completion_id, None);
}

#[test]
fn running_deadline_survives_reopen_and_expire_creates_one_completion() {
    let directory = TestDirectory::new();
    let clock = FakeClock::new(5_000);
    let first = state(&directory, clock.clone(), "first");
    let started = first.start("start", TimerPhase::Focus, 10_000).unwrap();
    let generation = started.snapshot.generation;

    let reopened = state(&directory, clock.clone(), "second");
    let before = reopened.get_snapshot().unwrap();
    assert_eq!(before.state, TimerStateKind::Running);
    assert_eq!(before.remaining_ms, 10_000);
    assert_eq!(before.deadline_utc, Some(15_000));

    clock.set(15_001);
    let expired = reopened.expire("expire", generation).unwrap();
    assert_eq!(expired.snapshot.state, TimerStateKind::Completed);
    assert_eq!(expired.snapshot.remaining_ms, 0);
    assert!(expired.snapshot.completion_id.is_some());
    let completion_id = expired.snapshot.completion_id.clone();

    let replay = reopened.expire("expire-replay", generation).unwrap();
    assert_eq!(replay.snapshot.revision, expired.snapshot.revision);
    assert_eq!(replay.snapshot.completion_id, completion_id);
}

#[test]
fn old_generation_cannot_expire_a_reset_or_resumed_timer() {
    let directory = TestDirectory::new();
    let clock = FakeClock::new(0);
    let timer = state(&directory, clock.clone(), "test");
    let started = timer.start("start", TimerPhase::Focus, 10_000).unwrap();
    let old_generation = started.snapshot.generation;
    timer.reset("reset", Some(20_000)).unwrap();
    let restarted = timer
        .start("start-again", TimerPhase::Break, 20_000)
        .unwrap();
    assert!(restarted.snapshot.generation > old_generation);

    clock.set(10_001);
    let ignored = timer.expire("old-expire", old_generation).unwrap();
    assert_eq!(ignored.snapshot.state, TimerStateKind::Running);
    assert_eq!(ignored.snapshot.phase, TimerPhase::Break);
    assert_eq!(ignored.snapshot.generation, restarted.snapshot.generation);
}

#[test]
fn expiry_after_sleep_finishes_only_current_phase_until_manually_restarted() {
    let directory = TestDirectory::new();
    let clock = FakeClock::new(100);
    let timer = state(&directory, clock.clone(), "test");
    let focus = timer.start("focus", TimerPhase::Focus, 1_000).unwrap();
    clock.set(100_000);
    let completed = timer
        .expire("sleep-expire", focus.snapshot.generation)
        .unwrap();
    assert_eq!(completed.snapshot.phase, TimerPhase::Focus);
    assert_eq!(completed.snapshot.state, TimerStateKind::Completed);

    let break_timer = timer.start("break", TimerPhase::Break, 2_000).unwrap();
    assert_eq!(break_timer.snapshot.phase, TimerPhase::Break);
    assert_eq!(break_timer.snapshot.state, TimerStateKind::Running);
}

#[test]
fn backward_clock_jump_sets_anomaly_without_fabricating_completion() {
    let directory = TestDirectory::new();
    let clock = FakeClock::new(100_000);
    let timer = state(&directory, clock.clone(), "test");
    let started = timer.start("start", TimerPhase::Focus, 30_000).unwrap();
    clock.set(1_000);
    let snapshot = timer.get_snapshot().unwrap();
    assert_eq!(snapshot.state, TimerStateKind::Running);
    assert!(snapshot.clock_anomaly);
    assert_eq!(snapshot.remaining_ms, 30_000);
    assert_eq!(snapshot.completion_id, None);
    assert!(snapshot.revision > started.snapshot.revision);
}

#[test]
fn pause_after_clock_rollback_keeps_trusted_remaining_and_resume_rebases_clock() {
    let directory = TestDirectory::new();
    let clock = FakeClock::new(100_000);
    let timer = state(&directory, clock.clone(), "test");
    timer.start("start", TimerPhase::Focus, 30_000).unwrap();
    clock.set(1_000);
    let paused = timer.pause("pause").unwrap();
    assert_eq!(paused.snapshot.state, TimerStateKind::Paused);
    assert_eq!(paused.snapshot.remaining_ms, 30_000);
    assert!(paused.snapshot.clock_anomaly);

    let resumed = timer.resume("resume").unwrap();
    assert_eq!(resumed.snapshot.state, TimerStateKind::Running);
    assert_eq!(resumed.snapshot.deadline_utc, Some(31_000));
    assert!(!resumed.snapshot.clock_anomaly);
}

#[test]
fn action_replay_is_idempotent_and_does_not_advance_revision() {
    let directory = TestDirectory::new();
    let clock = FakeClock::new(0);
    let timer = state(&directory, clock, "test");
    let first = timer.start("same", TimerPhase::Focus, 10_000).unwrap();
    let replay = timer.start("same", TimerPhase::Break, 20_000).unwrap();
    assert_eq!(replay.snapshot.revision, first.snapshot.revision);
    assert_eq!(replay.snapshot.phase, TimerPhase::Focus);
    assert_eq!(replay.snapshot.duration_ms, 10_000);
}

#[test]
fn invalid_transition_and_duration_do_not_change_saved_state() {
    let directory = TestDirectory::new();
    let clock = FakeClock::new(0);
    let timer = state(&directory, clock, "test");
    assert_eq!(
        timer.pause("pause").unwrap_err().code,
        "timer_state_invalid"
    );
    assert_eq!(
        timer
            .start("invalid", TimerPhase::Focus, 999)
            .unwrap_err()
            .code,
        "timer_duration_invalid"
    );
    let snapshot = timer.get_snapshot().unwrap();
    assert_eq!(snapshot.state, TimerStateKind::Idle);
    assert_eq!(snapshot.duration_ms, 25 * 60 * 1000);
    assert_eq!(snapshot.revision, 0);
}

#[test]
fn query_only_database_refuses_mutation_without_losing_timer() {
    let directory = TestDirectory::new();
    let clock = FakeClock::new(0);
    let timer = state(&directory, clock, "test");
    let saved = timer.start("start", TimerPhase::Focus, 10_000).unwrap();
    timer
        .store()
        .unwrap()
        .database
        .with_connection(|connection| -> Result<(), TimerError> {
            connection
                .execute_batch("PRAGMA query_only = ON;")
                .map_err(|_| TimerError::storage_unavailable())?;
            Ok(())
        })
        .unwrap();
    let failure = timer.reset("reset", None).unwrap_err();
    assert_eq!(failure.code, "storage_unavailable");
    assert!(failure.retryable);

    let connection = rusqlite::Connection::open(directory.database()).unwrap();
    let state_value: String = connection
        .query_row(
            "SELECT state FROM timer_state WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(state_value, "running");
    assert_eq!(saved.snapshot.state, TimerStateKind::Running);
}

#[test]
fn failed_migration_rolls_back_and_does_not_destroy_database() {
    let directory = TestDirectory::new();
    let path = directory.database();
    let migrations = [
        crate::storage::sqlite::Migration {
            version: 1,
            sql: "CREATE TABLE timer_test(id INTEGER PRIMARY KEY);",
        },
        crate::storage::sqlite::Migration {
            version: 2,
            sql: "CREATE TABLE timer_test(id INTEGER PRIMARY KEY);",
        },
    ];
    assert!(matches!(
        crate::storage::sqlite::SqliteDatabase::open(&path, &migrations),
        Err(StorageError::Database)
    ));
    let connection = rusqlite::Connection::open(path).unwrap();
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 0);
}

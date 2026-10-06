use super::{
    protect_text, unprotect_text, CaptureCandidate, CaptureOutcome, ClearScope, ClipboardBackend,
    ClipboardBackendError, ClipboardHistory, ClipboardObserver, ClipboardPolicy,
    ClipboardProtectionError, ClipboardRuntime, ClipboardStorageError, ClipboardStore,
    ObservedClipboardText, PinOutcome, ProtectionScope, TextProtector, WindowsDpapiProtector,
};
use rusqlite::Connection;
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureCandidate {
    text: String,
    observed_at_ms: u64,
    source_app_id: Option<String>,
    exclude_from_history: bool,
    restore_marker: Option<String>,
}

#[derive(Deserialize)]
struct CandidateFixtures {
    normal: FixtureCandidate,
    excluded: FixtureCandidate,
    #[serde(rename = "pathSource")]
    path_source: FixtureCandidate,
}

impl From<FixtureCandidate> for CaptureCandidate {
    fn from(value: FixtureCandidate) -> Self {
        Self {
            text: value.text,
            observed_at_ms: value.observed_at_ms,
            source_app_id: value.source_app_id,
            exclude_from_history: value.exclude_from_history,
            restore_marker: value.restore_marker,
        }
    }
}

fn fixtures() -> CandidateFixtures {
    serde_json::from_str(include_str!(
        "../../../../tests/fixtures/clipboard/candidates.json"
    ))
    .expect("synthetic clipboard fixture should parse")
}

fn enabled_policy() -> ClipboardPolicy {
    ClipboardPolicy {
        enabled: true,
        ..ClipboardPolicy::default()
    }
}

fn candidate(text: &str, observed_at_ms: u64) -> CaptureCandidate {
    CaptureCandidate {
        text: text.into(),
        observed_at_ms,
        source_app_id: None,
        exclude_from_history: false,
        restore_marker: None,
    }
}

static TEST_DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new(label: &str) -> Self {
        let sequence = TEST_DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "widget-platform-clipboard-{label}-{}-{sequence}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("test directory should be created");
        Self(path)
    }

    fn database(&self) -> PathBuf {
        self.0.join("clipboard.sqlite3")
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn default_policy_is_disabled_and_has_bounded_working_defaults() {
    let policy = ClipboardPolicy::default();

    assert!(!policy.enabled);
    assert_eq!(policy.retention_ms, 7 * 24 * 60 * 60 * 1_000);
    assert_eq!(policy.max_unpinned_entries, 200);
    assert_eq!(policy.max_total_bytes, 10 * 1024 * 1024);
    assert!(policy.validate().is_ok());

    let mut history = ClipboardHistory::new();
    assert_eq!(
        history.capture(&policy, candidate("synthetic text", 1_000)),
        CaptureOutcome::Disabled
    );
    assert!(history.entries(&policy, 1_000).is_empty());
}

#[test]
fn capture_normalizes_line_endings_and_minimizes_source_identity() {
    let fixtures = fixtures();
    let mut history = ClipboardHistory::new();
    let policy = enabled_policy();

    let inserted = history.capture(&policy, fixtures.normal.into());
    assert!(matches!(inserted, CaptureOutcome::Inserted { .. }));
    assert_eq!(
        history.entries(&policy, 1_000)[0].text,
        "first line\nsecond line"
    );
    assert_eq!(
        history.entries(&policy, 1_000)[0].source_app_id.as_deref(),
        Some("editor.exe")
    );

    history.capture(&policy, fixtures.path_source.into());
    assert_eq!(history.entries(&policy, 3_000)[0].source_app_id, None);

    let mut title_like = candidate("title source", 4_000);
    title_like.source_app_id = Some("Quarterly_Report".into());
    history.capture(&policy, title_like);
    assert_eq!(history.entries(&policy, 4_000)[0].source_app_id, None);
}

#[test]
fn exclusion_marker_empty_text_and_adjacent_duplicates_do_not_create_history() {
    let fixtures = fixtures();
    let mut history = ClipboardHistory::new();
    let policy = enabled_policy();

    assert_eq!(
        history.capture(&policy, fixtures.excluded.into()),
        CaptureOutcome::Excluded {
            reason: super::ExclusionReason::MarkedNoHistory,
            evicted_ids: Vec::new(),
        }
    );
    assert_eq!(
        history.capture(&policy, candidate("", 2_001)),
        CaptureOutcome::Excluded {
            reason: super::ExclusionReason::EmptyText,
            evicted_ids: Vec::new(),
        }
    );
    assert!(matches!(
        history.capture(&policy, candidate("same\r\ntext", 3_000)),
        CaptureOutcome::Inserted { .. }
    ));
    assert!(matches!(
        history.capture(&policy, candidate("same\ntext", 3_100)),
        CaptureOutcome::Duplicate { .. }
    ));
    assert_eq!(history.entries(&policy, 3_100).len(), 1);
}

#[test]
fn duplicate_reports_expired_entries_removed_by_the_same_operation() {
    let mut history = ClipboardHistory::new();
    let policy = ClipboardPolicy {
        enabled: true,
        retention_ms: 100,
        max_unpinned_entries: 10,
        max_total_bytes: 1_024,
    };
    let first_id = match history.capture(&policy, candidate("old", 1_000)) {
        CaptureOutcome::Inserted { entry_id, .. } => entry_id,
        _ => panic!("old entry should insert"),
    };
    history.capture(&policy, candidate("same", 1_050));

    let CaptureOutcome::Duplicate { evicted_ids, .. } =
        history.capture(&policy, candidate("same", 1_101))
    else {
        panic!("latest text should deduplicate");
    };
    assert_eq!(evicted_ids, vec![first_id]);
}

#[test]
fn excluded_capture_still_removes_and_reports_expired_entries() {
    let mut history = ClipboardHistory::new();
    let policy = ClipboardPolicy {
        enabled: true,
        retention_ms: 100,
        max_unpinned_entries: 10,
        max_total_bytes: 1_024,
    };
    let expired_id = match history.capture(&policy, candidate("old", 1_000)) {
        CaptureOutcome::Inserted { entry_id, .. } => entry_id,
        _ => panic!("old entry should insert"),
    };
    let mut excluded = candidate("ignored", 1_101);
    excluded.exclude_from_history = true;

    assert_eq!(
        history.capture(&policy, excluded),
        CaptureOutcome::Excluded {
            reason: super::ExclusionReason::MarkedNoHistory,
            evicted_ids: vec![expired_id],
        }
    );
    assert!(history.entries(&policy, 1_101).is_empty());
}

#[test]
fn restore_generates_unique_one_time_markers_without_pasting() {
    let mut history = ClipboardHistory::new();
    let policy = enabled_policy();
    let CaptureOutcome::Inserted { entry_id, .. } =
        history.capture(&policy, candidate("restore me", 1_000))
    else {
        panic!("entry should insert");
    };

    let first = history
        .prepare_restore(&policy, 1_000, &entry_id, "restore-action-1")
        .expect("restore payload should exist");
    let second = history
        .prepare_restore(&policy, 1_000, &entry_id, "restore-action-1")
        .expect("second restore payload should exist");
    assert_eq!(first.text, "restore me");
    assert!(first.marker.starts_with("widget-platform:"));
    assert_ne!(first.marker, second.marker);

    assert_eq!(
        history.capture(
            &policy,
            CaptureCandidate {
                text: first.text.clone(),
                observed_at_ms: 1_001,
                source_app_id: None,
                exclude_from_history: false,
                restore_marker: Some(first.marker.clone()),
            },
        ),
        CaptureOutcome::Excluded {
            reason: super::ExclusionReason::SelfRestore,
            evicted_ids: Vec::new(),
        }
    );
    assert!(matches!(
        history.capture(
            &policy,
            CaptureCandidate {
                text: first.text,
                observed_at_ms: 1_002,
                source_app_id: None,
                exclude_from_history: false,
                restore_marker: Some(first.marker),
            },
        ),
        CaptureOutcome::Duplicate { .. }
    ));
    assert_eq!(
        history.capture(
            &policy,
            CaptureCandidate {
                text: second.text,
                observed_at_ms: 1_003,
                source_app_id: None,
                exclude_from_history: false,
                restore_marker: Some(second.marker),
            },
        ),
        CaptureOutcome::Excluded {
            reason: super::ExclusionReason::SelfRestore,
            evicted_ids: Vec::new(),
        }
    );
    assert_eq!(history.entries(&policy, 1_003).len(), 1);
}

#[test]
fn restore_marker_capacity_rejects_new_work_without_forgetting_pending_markers() {
    let mut history = ClipboardHistory::new();
    let policy = enabled_policy();
    let entry_id = match history.capture(&policy, candidate("restore me", 1_000)) {
        CaptureOutcome::Inserted { entry_id, .. } => entry_id,
        _ => panic!("entry should insert"),
    };
    let first = history
        .prepare_restore(&policy, 1_000, &entry_id, "first")
        .expect("first restore should be prepared");
    for index in 1..64 {
        history
            .prepare_restore(&policy, 1_000, &entry_id, &format!("action-{index}"))
            .expect("queue should accept up to its documented capacity");
    }
    assert!(history
        .prepare_restore(&policy, 1_000, &entry_id, "overflow")
        .is_none());
    assert_eq!(
        history.capture(
            &policy,
            CaptureCandidate {
                text: first.text,
                observed_at_ms: 1_001,
                source_app_id: None,
                exclude_from_history: false,
                restore_marker: Some(first.marker),
            },
        ),
        CaptureOutcome::Excluded {
            reason: super::ExclusionReason::SelfRestore,
            evicted_ids: Vec::new(),
        }
    );
}

#[test]
fn restore_markers_are_distinct_across_history_instances() {
    let policy = enabled_policy();
    let mut first_history = ClipboardHistory::new();
    let mut second_history = ClipboardHistory::new();
    let first_id = match first_history.capture(&policy, candidate("one", 1_000)) {
        CaptureOutcome::Inserted { entry_id, .. } => entry_id,
        _ => panic!("first entry should insert"),
    };
    let second_id = match second_history.capture(&policy, candidate("two", 1_000)) {
        CaptureOutcome::Inserted { entry_id, .. } => entry_id,
        _ => panic!("second entry should insert"),
    };

    let first_marker = first_history
        .prepare_restore(&policy, 1_000, &first_id, "same-action")
        .expect("first marker")
        .marker;
    let second_marker = second_history
        .prepare_restore(&policy, 1_000, &second_id, "same-action")
        .expect("second marker")
        .marker;
    assert_ne!(first_marker, second_marker);
}

#[test]
fn expired_entries_are_removed_when_browsed_and_cannot_be_restored() {
    let mut history = ClipboardHistory::new();
    let policy = ClipboardPolicy {
        enabled: true,
        retention_ms: 100,
        max_unpinned_entries: 10,
        max_total_bytes: 1_024,
    };
    let expired_id = match history.capture(&policy, candidate("expires", 1_000)) {
        CaptureOutcome::Inserted { entry_id, .. } => entry_id,
        _ => panic!("entry should insert"),
    };

    assert_eq!(
        history.set_pinned(&policy, 1_101, &expired_id, true),
        PinOutcome::NotFound
    );
    assert!(history.page(&policy, 1_101, 0, 10).is_empty());
    assert!(history
        .prepare_restore(&policy, 1_101, &expired_id, "restore-expired")
        .is_none());
}

#[test]
fn unpin_removes_an_entry_that_has_already_exceeded_retention() {
    let mut history = ClipboardHistory::new();
    let policy = ClipboardPolicy {
        enabled: true,
        retention_ms: 100,
        max_unpinned_entries: 10,
        max_total_bytes: 1_024,
    };
    let entry_id = match history.capture(&policy, candidate("old pin", 1_000)) {
        CaptureOutcome::Inserted { entry_id, .. } => entry_id,
        _ => panic!("entry should insert"),
    };
    assert_eq!(
        history.set_pinned(&policy, 1_000, &entry_id, true),
        PinOutcome::Updated
    );

    assert_eq!(
        history.set_pinned(&policy, 1_101, &entry_id, false),
        PinOutcome::ExpiredRemoved {
            entry_id: entry_id.clone(),
        }
    );
    assert!(history.entries(&policy, 1_101).is_empty());
}

#[test]
fn retention_and_entry_limit_evict_only_oldest_unpinned_entries() {
    let mut history = ClipboardHistory::new();
    let policy = ClipboardPolicy {
        enabled: true,
        retention_ms: 100,
        max_unpinned_entries: 2,
        max_total_bytes: 1_024,
    };

    let CaptureOutcome::Inserted {
        entry_id: pinned_id,
        ..
    } = history.capture(&policy, candidate("pinned", 1_000))
    else {
        panic!("entry should insert");
    };
    assert_eq!(
        history.set_pinned(&policy, 1_000, &pinned_id, true),
        PinOutcome::Updated
    );
    history.capture(&policy, candidate("expired", 1_010));
    history.capture(&policy, candidate("new-a", 1_200));
    history.capture(&policy, candidate("new-b", 1_201));
    history.capture(&policy, candidate("new-c", 1_202));

    let entries = history.entries(&policy, 1_202);
    let texts = entries
        .iter()
        .map(|entry| entry.text.as_str())
        .collect::<Vec<_>>();
    assert_eq!(texts, vec!["new-c", "new-b", "pinned"]);
    assert!(entries
        .iter()
        .any(|entry| entry.id == pinned_id && entry.pinned));
}

#[test]
fn total_byte_limit_never_silently_deletes_pinned_entries() {
    let mut history = ClipboardHistory::new();
    let policy = ClipboardPolicy {
        enabled: true,
        retention_ms: 10_000,
        max_unpinned_entries: 200,
        max_total_bytes: 10,
    };
    let CaptureOutcome::Inserted { entry_id, .. } =
        history.capture(&policy, candidate("123456", 1_000))
    else {
        panic!("entry should insert");
    };
    assert_eq!(
        history.set_pinned(&policy, 1_000, &entry_id, true),
        PinOutcome::Updated
    );

    assert_eq!(
        history.capture(&policy, candidate("abcdef", 1_001)),
        CaptureOutcome::CapacityExceeded {
            evicted_ids: Vec::new(),
        }
    );
    assert_eq!(history.entries(&policy, 1_001).len(), 1);
    assert_eq!(history.entries(&policy, 1_001)[0].id, entry_id);
}

#[test]
fn pin_is_rejected_when_current_data_exceeds_a_lowered_hard_limit() {
    let mut history = ClipboardHistory::new();
    let original = ClipboardPolicy {
        enabled: true,
        retention_ms: 10_000,
        max_unpinned_entries: 200,
        max_total_bytes: 10,
    };
    let entry_id = match history.capture(&original, candidate("123456", 1_000)) {
        CaptureOutcome::Inserted { entry_id, .. } => entry_id,
        _ => panic!("entry should insert"),
    };
    let lowered = ClipboardPolicy {
        max_total_bytes: 5,
        ..original
    };

    assert_eq!(
        history.set_pinned(&lowered, 1_000, &entry_id, true),
        PinOutcome::CapacityExceeded
    );
    assert!(!history.entries(&lowered, 1_000)[0].pinned);
}

#[test]
fn large_clock_rollback_conservatively_expires_unpinned_text() {
    let mut history = ClipboardHistory::new();
    let policy = enabled_policy();
    let pinned_id = match history.capture(&policy, candidate("pinned", 10_000)) {
        CaptureOutcome::Inserted { entry_id, .. } => entry_id,
        _ => panic!("entry should insert"),
    };
    assert_eq!(
        history.set_pinned(&policy, 10_000, &pinned_id, true),
        PinOutcome::Updated
    );
    history.capture(&policy, candidate("private unpinned", 10_001));

    let entries = history.entries(&policy, 9_000);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].id, pinned_id);

    assert!(matches!(
        history.capture(&policy, candidate("new baseline", 9_001)),
        CaptureOutcome::Inserted { .. }
    ));
    let entries = history.entries(&policy, 9_001);
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].text, "new baseline");
}

#[test]
fn paging_delete_and_clear_have_explicit_scopes() {
    let mut history = ClipboardHistory::new();
    let policy = enabled_policy();
    let first = match history.capture(&policy, candidate("one", 1_000)) {
        CaptureOutcome::Inserted { entry_id, .. } => entry_id,
        _ => panic!("entry should insert"),
    };
    let second = match history.capture(&policy, candidate("two", 1_001)) {
        CaptureOutcome::Inserted { entry_id, .. } => entry_id,
        _ => panic!("entry should insert"),
    };
    let third = match history.capture(&policy, candidate("three", 1_002)) {
        CaptureOutcome::Inserted { entry_id, .. } => entry_id,
        _ => panic!("entry should insert"),
    };
    assert_eq!(
        history.set_pinned(&policy, 1_002, &second, true),
        PinOutcome::Updated
    );

    assert_eq!(
        history
            .page(&policy, 1_002, 1, 1)
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        vec![second.as_str()]
    );
    assert!(history.delete(&third));
    assert!(!history.delete("missing"));
    assert_eq!(history.clear(ClearScope::Unpinned), 1);
    assert_eq!(history.entries(&policy, 1_002)[0].id, second);
    assert_eq!(history.clear(ClearScope::All), 1);
    assert!(history.entries(&policy, 1_002).is_empty());
    assert_ne!(first, second);
}

#[derive(Default)]
struct RecordingProtector {
    scopes: Mutex<Vec<ProtectionScope>>,
    fail: bool,
    empty_unprotect: bool,
}

impl TextProtector for RecordingProtector {
    fn protect(
        &self,
        scope: ProtectionScope,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, ClipboardProtectionError> {
        self.scopes.lock().unwrap().push(scope);
        if self.fail {
            return Err(ClipboardProtectionError::Unavailable);
        }
        Ok(plaintext.iter().rev().copied().collect())
    }

    fn unprotect(
        &self,
        scope: ProtectionScope,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, ClipboardProtectionError> {
        self.scopes.lock().unwrap().push(scope);
        if self.fail {
            return Err(ClipboardProtectionError::Unavailable);
        }
        if self.empty_unprotect {
            return Ok(Vec::new());
        }
        Ok(ciphertext.iter().rev().copied().collect())
    }
}

#[test]
fn protection_contract_is_current_user_only_and_errors_never_echo_plaintext() {
    let protector = RecordingProtector::default();
    let protected = protect_text(&protector, "synthetic secret").expect("protection should work");
    assert_eq!(protected.version, 1);
    assert_ne!(protected.ciphertext, b"synthetic secret");
    assert_eq!(
        unprotect_text(&protector, &protected).expect("unprotect should work"),
        "synthetic secret"
    );
    assert_eq!(
        protector.scopes.lock().unwrap().as_slice(),
        &[ProtectionScope::CurrentUser, ProtectionScope::CurrentUser]
    );

    let failing = RecordingProtector {
        fail: true,
        ..RecordingProtector::default()
    };
    let error = protect_text(&failing, "must-not-appear").unwrap_err();
    assert_eq!(error, ClipboardProtectionError::Unavailable);
    assert!(!format!("{error:?}").contains("must-not-appear"));

    let invalid = super::ProtectedClipboardText {
        version: 2,
        ciphertext: vec![1, 2, 3],
    };
    assert_eq!(
        unprotect_text(&protector, &invalid),
        Err(ClipboardProtectionError::InvalidPayload)
    );

    let empty = RecordingProtector {
        empty_unprotect: true,
        ..RecordingProtector::default()
    };
    let version_one = super::ProtectedClipboardText {
        version: 1,
        ciphertext: vec![1],
    };
    assert_eq!(
        unprotect_text(&empty, &version_one),
        Err(ClipboardProtectionError::InvalidPayload)
    );
}

#[derive(Default)]
struct ToggleProtector {
    fail: AtomicBool,
}

impl TextProtector for ToggleProtector {
    fn protect(
        &self,
        _scope: ProtectionScope,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, ClipboardProtectionError> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(ClipboardProtectionError::Unavailable);
        }
        Ok(plaintext.iter().rev().copied().collect())
    }

    fn unprotect(
        &self,
        _scope: ProtectionScope,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, ClipboardProtectionError> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(ClipboardProtectionError::Unavailable);
        }
        Ok(ciphertext.iter().rev().copied().collect())
    }
}

fn inserted_entry(
    history: &mut ClipboardHistory,
    policy: &ClipboardPolicy,
    text: &str,
    observed_at_ms: u64,
) -> (CaptureOutcome, super::ClipboardEntry) {
    let outcome = history.capture(policy, candidate(text, observed_at_ms));
    let CaptureOutcome::Inserted { entry_id, .. } = &outcome else {
        panic!("entry should insert");
    };
    let entry = history
        .entries(policy, observed_at_ms)
        .iter()
        .find(|entry| &entry.id == entry_id)
        .expect("inserted entry should exist")
        .clone();
    (outcome, entry)
}

#[test]
fn encrypted_store_round_trips_entries_without_plaintext_in_the_database_file() {
    let directory = TestDirectory::new("encrypted-store");
    let path = directory.database();
    let protector = Arc::new(ToggleProtector::default());
    let store =
        ClipboardStore::open(path.clone(), protector.clone()).expect("clipboard store should open");
    let policy = enabled_policy();
    let mut history = ClipboardHistory::new();
    let secret = "synthetic clipboard secret";
    let (outcome, entry) = inserted_entry(&mut history, &policy, secret, 1_000);

    assert_eq!(
        store
            .apply_capture(&outcome, Some(&entry))
            .expect("capture should persist"),
        1
    );
    drop(store);

    let raw = fs::read(&path).expect("database file should be readable");
    assert!(!raw
        .windows(secret.len())
        .any(|window| window == secret.as_bytes()));

    let reopened = ClipboardStore::open(path, protector).expect("store should reopen");
    let snapshot = reopened.load_snapshot().expect("snapshot should decrypt");
    assert_eq!(snapshot.revision, 1);
    assert_eq!(snapshot.entries, vec![entry]);
}

#[test]
fn protection_failure_does_not_partially_replace_existing_rows() {
    let directory = TestDirectory::new("protect-failure");
    let protector = Arc::new(ToggleProtector::default());
    let store = ClipboardStore::open(directory.database(), protector.clone())
        .expect("clipboard store should open");
    let policy = enabled_policy();
    let mut history = ClipboardHistory::new();
    let (first_outcome, first_entry) = inserted_entry(&mut history, &policy, "first", 1_000);
    store
        .apply_capture(&first_outcome, Some(&first_entry))
        .expect("first entry should persist");

    let (second_outcome, second_entry) =
        inserted_entry(&mut history, &policy, "must not persist", 1_001);
    protector.fail.store(true, Ordering::SeqCst);
    assert_eq!(
        store.apply_capture(&second_outcome, Some(&second_entry)),
        Err(ClipboardStorageError::Protection)
    );
    protector.fail.store(false, Ordering::SeqCst);

    let snapshot = store.load_snapshot().expect("old snapshot should remain");
    assert_eq!(snapshot.revision, 1);
    assert_eq!(snapshot.entries, vec![first_entry]);
}

#[test]
fn malformed_ciphertext_is_reported_without_deleting_the_database() {
    let directory = TestDirectory::new("malformed-ciphertext");
    let path = directory.database();
    let protector = Arc::new(ToggleProtector::default());
    let store = ClipboardStore::open(path.clone(), protector).expect("store should open");
    let policy = enabled_policy();
    let mut history = ClipboardHistory::new();
    let (outcome, entry) = inserted_entry(&mut history, &policy, "synthetic", 1_000);
    store
        .apply_capture(&outcome, Some(&entry))
        .expect("entry should persist");

    Connection::open(&path)
        .expect("diagnostic connection should open")
        .execute(
            "UPDATE clipboard_entries SET ciphertext = X'FF' WHERE id = ?1",
            [&entry.id],
        )
        .expect("ciphertext should be corrupted for the test");
    assert_eq!(
        store.load_snapshot(),
        Err(ClipboardStorageError::CorruptData)
    );
    assert!(path.exists());
}

#[test]
fn unsupported_clipboard_schema_is_preserved_and_rejected() {
    let directory = TestDirectory::new("unsupported-schema");
    let path = directory.database();
    let connection = Connection::open(&path).expect("database should open");
    connection
        .pragma_update(None, "user_version", 99)
        .expect("future schema should be set");
    drop(connection);

    assert!(matches!(
        ClipboardStore::open(path.clone(), Arc::new(ToggleProtector::default())),
        Err(ClipboardStorageError::UnsupportedSchema)
    ));
    assert!(path.exists());
}

#[cfg(windows)]
#[test]
fn windows_dpapi_round_trip_uses_current_user_with_synthetic_text() {
    let protector = WindowsDpapiProtector;
    let protected = protect_text(&protector, "synthetic dpapi text")
        .expect("CurrentUser DPAPI protection should work");
    assert_ne!(protected.ciphertext, b"synthetic dpapi text");
    assert_eq!(
        unprotect_text(&protector, &protected).expect("CurrentUser DPAPI unprotect should work"),
        "synthetic dpapi text"
    );
}

#[derive(Default)]
struct FakeClipboardBackend {
    start_count: AtomicUsize,
    stop_count: AtomicUsize,
    observer: Mutex<Option<ClipboardObserver>>,
    writes: Mutex<Vec<(String, String)>>,
}

impl FakeClipboardBackend {
    fn emit(&self, event: ObservedClipboardText) {
        let observer = self
            .observer
            .lock()
            .expect("observer lock should remain healthy")
            .clone()
            .expect("listener should be active");
        observer(event);
    }
}

impl ClipboardBackend for FakeClipboardBackend {
    fn start(&self, observer: ClipboardObserver) -> Result<(), ClipboardBackendError> {
        self.start_count.fetch_add(1, Ordering::SeqCst);
        *self
            .observer
            .lock()
            .expect("observer lock should remain healthy") = Some(observer);
        Ok(())
    }

    fn stop(&self) -> Result<(), ClipboardBackendError> {
        self.stop_count.fetch_add(1, Ordering::SeqCst);
        *self
            .observer
            .lock()
            .expect("observer lock should remain healthy") = None;
        Ok(())
    }

    fn write_text(&self, text: &str, marker: &str) -> Result<(), ClipboardBackendError> {
        self.writes
            .lock()
            .expect("writes lock should remain healthy")
            .push((text.to_owned(), marker.to_owned()));
        Ok(())
    }
}

#[test]
fn runtime_stays_off_until_enabled_then_persists_synthetic_listener_events() {
    let directory = TestDirectory::new("runtime-capture");
    let path = directory.database();
    let protector = Arc::new(ToggleProtector::default());
    let backend = Arc::new(FakeClipboardBackend::default());
    let runtime = ClipboardRuntime::open(
        path.clone(),
        protector.clone(),
        backend.clone(),
        ClipboardPolicy::default(),
    )
    .expect("runtime should open");

    let initial = runtime
        .snapshot(1_000, 0, 50)
        .expect("initial snapshot should load");
    assert!(!initial.enabled);
    assert!(!initial.listening);
    assert_eq!(backend.start_count.load(Ordering::SeqCst), 0);

    runtime
        .set_enabled(true)
        .expect("enabling should start the listener");
    assert_eq!(backend.start_count.load(Ordering::SeqCst), 1);
    backend.emit(ObservedClipboardText {
        text: "synthetic listener text".into(),
        observed_at_ms: 1_001,
        source_app_id: Some("Editor.exe".into()),
        exclude_from_history: false,
        restore_marker: None,
    });

    let captured = runtime
        .snapshot(1_001, 0, 50)
        .expect("captured snapshot should load");
    assert!(captured.enabled);
    assert!(captured.listening);
    assert_eq!(captured.revision, 1);
    assert_eq!(captured.total_entries, 1);
    assert_eq!(captured.entries[0].text, "synthetic listener text");
    drop(runtime);

    let reopened_backend = Arc::new(FakeClipboardBackend::default());
    let reopened = ClipboardRuntime::open(
        path,
        protector,
        reopened_backend.clone(),
        ClipboardPolicy::default(),
    )
    .expect("runtime should reopen");
    let persisted = reopened
        .snapshot(1_001, 0, 50)
        .expect("persisted snapshot should load");
    assert_eq!(persisted.revision, 1);
    assert_eq!(persisted.entries[0].text, "synthetic listener text");
    assert_eq!(reopened_backend.start_count.load(Ordering::SeqCst), 0);
}

#[test]
fn runtime_restore_writes_a_marker_and_excludes_the_matching_listener_event() {
    let directory = TestDirectory::new("runtime-restore");
    let backend = Arc::new(FakeClipboardBackend::default());
    let runtime = ClipboardRuntime::open(
        directory.database(),
        Arc::new(ToggleProtector::default()),
        backend.clone(),
        ClipboardPolicy::default(),
    )
    .expect("runtime should open");
    runtime.set_enabled(true).expect("listener should start");
    backend.emit(ObservedClipboardText {
        text: "restore me".into(),
        observed_at_ms: 2_000,
        source_app_id: None,
        exclude_from_history: false,
        restore_marker: None,
    });
    let entry_id = runtime
        .snapshot(2_000, 0, 50)
        .expect("snapshot should load")
        .entries[0]
        .id
        .clone();

    runtime
        .restore(2_001, &entry_id, "restore-action-1")
        .expect("restore should write the clipboard");
    let (written_text, marker) = backend
        .writes
        .lock()
        .expect("writes lock should remain healthy")[0]
        .clone();
    assert_eq!(written_text, "restore me");
    backend.emit(ObservedClipboardText {
        text: written_text,
        observed_at_ms: 2_002,
        source_app_id: None,
        exclude_from_history: false,
        restore_marker: Some(marker),
    });

    let snapshot = runtime
        .snapshot(2_002, 0, 50)
        .expect("snapshot should load");
    assert_eq!(snapshot.revision, 1);
    assert_eq!(snapshot.total_entries, 1);
    assert_eq!(snapshot.entries[0].text, "restore me");
}

#[test]
fn restore_prunes_expired_rows_from_disk_before_returning_not_found() {
    let directory = TestDirectory::new("runtime-expired-restore");
    let path = directory.database();
    let backend = Arc::new(FakeClipboardBackend::default());
    let runtime = ClipboardRuntime::open(
        path.clone(),
        Arc::new(ToggleProtector::default()),
        backend.clone(),
        ClipboardPolicy::default(),
    )
    .expect("runtime should open");
    runtime.set_enabled(true).expect("listener should start");
    backend.emit(ObservedClipboardText {
        text: "expired synthetic text".into(),
        observed_at_ms: 1_000,
        source_app_id: None,
        exclude_from_history: false,
        restore_marker: None,
    });
    let id = runtime
        .snapshot(1_000, 0, 10)
        .expect("entry should exist")
        .entries[0]
        .id
        .clone();
    let after_expiry = 1_000 + enabled_policy().retention_ms;

    assert_eq!(
        runtime.restore(after_expiry, &id, "expired-restore"),
        Err(super::ClipboardRuntimeError::NotFoundOrInvalidAction)
    );
    assert!(backend
        .writes
        .lock()
        .expect("writes lock should remain healthy")
        .is_empty());
    let disk = ClipboardStore::open(path, Arc::new(ToggleProtector::default()))
        .expect("store should open");
    assert!(disk
        .load_snapshot()
        .expect("expired row should be removed")
        .entries
        .is_empty());
}

struct FailingStartBackend;

impl ClipboardBackend for FailingStartBackend {
    fn start(&self, observer: ClipboardObserver) -> Result<(), ClipboardBackendError> {
        observer(ObservedClipboardText {
            text: "synthetic pre-start callback".into(),
            observed_at_ms: 1_000,
            source_app_id: None,
            exclude_from_history: false,
            restore_marker: None,
        });
        Err(ClipboardBackendError::Unavailable)
    }

    fn stop(&self) -> Result<(), ClipboardBackendError> {
        Ok(())
    }

    fn write_text(&self, _text: &str, _marker: &str) -> Result<(), ClipboardBackendError> {
        Ok(())
    }
}

#[test]
fn failed_listener_start_cannot_persist_early_callback() {
    let directory = TestDirectory::new("failed-start");
    let runtime = ClipboardRuntime::open(
        directory.database(),
        Arc::new(ToggleProtector::default()),
        Arc::new(FailingStartBackend),
        ClipboardPolicy::default(),
    )
    .expect("runtime should open");

    assert_eq!(
        runtime.set_enabled(true),
        Err(super::ClipboardRuntimeError::Backend)
    );
    let snapshot = runtime
        .snapshot(1_001, 0, 10)
        .expect("failed start should not corrupt history");
    assert!(!snapshot.enabled);
    assert!(!snapshot.listening);
    assert_eq!(snapshot.total_entries, 0);
    assert_eq!(snapshot.revision, 0);
}

#[derive(Default)]
struct StopFailsOnceBackend {
    starts: AtomicUsize,
    stops: AtomicUsize,
}

impl ClipboardBackend for StopFailsOnceBackend {
    fn start(&self, _observer: ClipboardObserver) -> Result<(), ClipboardBackendError> {
        self.starts.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn stop(&self) -> Result<(), ClipboardBackendError> {
        let attempt = self.stops.fetch_add(1, Ordering::SeqCst);
        if attempt == 0 {
            Err(ClipboardBackendError::Busy)
        } else {
            Ok(())
        }
    }

    fn write_text(&self, _text: &str, _marker: &str) -> Result<(), ClipboardBackendError> {
        Ok(())
    }
}

#[test]
fn failed_stop_must_release_old_listener_before_next_start() {
    let directory = TestDirectory::new("stop-retry");
    let backend = Arc::new(StopFailsOnceBackend::default());
    let runtime = ClipboardRuntime::open(
        directory.database(),
        Arc::new(ToggleProtector::default()),
        backend.clone(),
        ClipboardPolicy::default(),
    )
    .expect("runtime should open");

    runtime
        .set_enabled(true)
        .expect("first start should succeed");
    assert_eq!(
        runtime.set_enabled(false),
        Err(super::ClipboardRuntimeError::Backend)
    );
    runtime
        .set_enabled(true)
        .expect("retry should release old listener then start");
    assert_eq!(backend.stops.load(Ordering::SeqCst), 2);
    assert_eq!(backend.starts.load(Ordering::SeqCst), 2);
}

#[test]
fn deleted_id_is_not_reused_after_runtime_restart() {
    let directory = TestDirectory::new("persistent-id-sequence");
    let path = directory.database();
    let protector = Arc::new(ToggleProtector::default());
    let backend = Arc::new(FakeClipboardBackend::default());
    let runtime = ClipboardRuntime::open(
        path.clone(),
        protector.clone(),
        backend.clone(),
        ClipboardPolicy::default(),
    )
    .expect("runtime should open");
    runtime.set_enabled(true).expect("listener should start");
    backend.emit(ObservedClipboardText {
        text: "first synthetic event".into(),
        observed_at_ms: 1_000,
        source_app_id: None,
        exclude_from_history: false,
        restore_marker: None,
    });
    let old_id = runtime
        .snapshot(1_000, 0, 10)
        .expect("old entry should exist")
        .entries[0]
        .id
        .clone();
    drop(runtime);
    let store = ClipboardStore::open(path.clone(), protector.clone()).expect("store should open");
    store
        .delete_ids(&[old_id.clone()])
        .expect("old entry should be deleted");
    drop(store);

    let next_backend = Arc::new(FakeClipboardBackend::default());
    let next_runtime = ClipboardRuntime::open(
        path,
        protector,
        next_backend.clone(),
        ClipboardPolicy::default(),
    )
    .expect("runtime should reopen");
    next_runtime
        .set_enabled(true)
        .expect("listener should start");
    next_backend.emit(ObservedClipboardText {
        text: "second synthetic event".into(),
        observed_at_ms: 1_001,
        source_app_id: None,
        exclude_from_history: false,
        restore_marker: None,
    });
    let new_id = next_runtime
        .snapshot(1_001, 0, 10)
        .expect("new entry should exist")
        .entries[0]
        .id
        .clone();
    assert_ne!(old_id, new_id);
}

#[test]
fn browse_without_evictions_still_updates_rollback_time_baseline() {
    let directory = TestDirectory::new("pinned-rollback-baseline");
    let path = directory.database();
    let protector = Arc::new(ToggleProtector::default());
    let store = ClipboardStore::open(path.clone(), protector.clone()).expect("store should open");
    let mut history = ClipboardHistory::new();
    let (outcome, mut pinned_entry) =
        inserted_entry(&mut history, &enabled_policy(), "pinned synthetic", 1_500);
    pinned_entry.pinned = true;
    let pinned_id = pinned_entry.id.clone();
    store
        .apply_capture(&outcome, Some(&pinned_entry))
        .expect("pinned fixture should persist");
    drop(store);
    let backend = Arc::new(FakeClipboardBackend::default());
    let runtime =
        ClipboardRuntime::open(path, protector, backend.clone(), ClipboardPolicy::default())
            .expect("runtime should open");
    runtime.set_enabled(true).expect("listener should start");
    assert_eq!(
        runtime
            .set_pinned(50_000, &pinned_id, true)
            .expect("retain pin"),
        PinOutcome::Updated
    );
    runtime
        .snapshot(50_000, 0, 10)
        .expect("first browse sets baseline");
    runtime
        .snapshot(2_000, 0, 10)
        .expect("rollback with only pinned entries resets baseline");
    assert_eq!(
        runtime.set_pinned(2_001, &pinned_id, false).expect("unpin"),
        PinOutcome::Updated
    );
    let snapshot = runtime.snapshot(2_001, 0, 10).expect("entry remains");
    assert_eq!(snapshot.total_entries, 1);
    assert!(!snapshot.entries[0].pinned);
}

struct BlockingWriteBackend {
    observer: Mutex<Option<ClipboardObserver>>,
    write_started: Mutex<Option<mpsc::Sender<()>>>,
    release_write: Mutex<mpsc::Receiver<()>>,
    stop_count: AtomicUsize,
}

impl ClipboardBackend for BlockingWriteBackend {
    fn start(&self, observer: ClipboardObserver) -> Result<(), ClipboardBackendError> {
        *self.observer.lock().expect("observer lock") = Some(observer);
        Ok(())
    }

    fn stop(&self) -> Result<(), ClipboardBackendError> {
        self.stop_count.fetch_add(1, Ordering::SeqCst);
        *self.observer.lock().expect("observer lock") = None;
        Ok(())
    }

    fn write_text(&self, _text: &str, _marker: &str) -> Result<(), ClipboardBackendError> {
        self.write_started
            .lock()
            .expect("write notification lock")
            .take()
            .expect("write notification should exist")
            .send(())
            .expect("test should await write");
        self.release_write
            .lock()
            .expect("release lock")
            .recv_timeout(Duration::from_secs(3))
            .expect("test should release write");
        Ok(())
    }
}

#[test]
fn disabling_during_restore_waits_for_the_write_to_finish() {
    let directory = TestDirectory::new("restore-disable-order");
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let backend = Arc::new(BlockingWriteBackend {
        observer: Mutex::new(None),
        write_started: Mutex::new(Some(started_tx)),
        release_write: Mutex::new(release_rx),
        stop_count: AtomicUsize::new(0),
    });
    let runtime = Arc::new(
        ClipboardRuntime::open(
            directory.database(),
            Arc::new(ToggleProtector::default()),
            backend.clone(),
            ClipboardPolicy::default(),
        )
        .expect("runtime should open"),
    );
    runtime.set_enabled(true).expect("listener should start");
    backend
        .observer
        .lock()
        .expect("observer lock")
        .clone()
        .expect("listener should exist")(ObservedClipboardText {
        text: "synthetic restore target".into(),
        observed_at_ms: 1_000,
        source_app_id: None,
        exclude_from_history: false,
        restore_marker: None,
    });
    let id = runtime.snapshot(1_000, 0, 10).expect("snapshot").entries[0]
        .id
        .clone();
    let restoring = Arc::clone(&runtime);
    let restore_task = thread::spawn(move || restoring.restore(1_001, &id, "action-restore"));
    started_rx
        .recv_timeout(Duration::from_secs(3))
        .expect("write must start");

    let disabling = Arc::clone(&runtime);
    let (disable_done_tx, disable_done_rx) = mpsc::channel();
    let disable_task = thread::spawn(move || {
        let result = disabling.set_enabled(false);
        disable_done_tx
            .send(result)
            .expect("disable result should send");
    });
    let disable_finished_early = disable_done_rx.recv_timeout(Duration::from_millis(100));
    release_tx.send(()).expect("release write");
    assert_eq!(restore_task.join().expect("restore task"), Ok(()));
    assert!(disable_finished_early.is_err());
    assert_eq!(
        disable_done_rx
            .recv_timeout(Duration::from_secs(3))
            .expect("disable should finish"),
        Ok(())
    );
    disable_task.join().expect("disable task");
    assert_eq!(backend.stop_count.load(Ordering::SeqCst), 1);
}

#[test]
fn runtime_pin_delete_and_clear_survive_reopen_without_touching_other_rows() {
    let directory = TestDirectory::new("runtime-mutations");
    let path = directory.database();
    let protector = Arc::new(ToggleProtector::default());
    let backend = Arc::new(FakeClipboardBackend::default());
    let runtime = ClipboardRuntime::open(
        path.clone(),
        protector.clone(),
        backend.clone(),
        ClipboardPolicy::default(),
    )
    .expect("runtime should open");
    runtime.set_enabled(true).expect("listener should start");
    for (text, time) in [
        ("keep pinned", 1_000),
        ("delete by id", 1_001),
        ("clear unpinned", 1_002),
    ] {
        backend.emit(ObservedClipboardText {
            text: text.into(),
            observed_at_ms: time,
            source_app_id: None,
            exclude_from_history: false,
            restore_marker: None,
        });
    }
    let entries = runtime.snapshot(1_002, 0, 10).expect("entries").entries;
    let id = |text| {
        entries
            .iter()
            .find(|entry| entry.text == text)
            .unwrap()
            .id
            .clone()
    };
    let pinned_id = id("keep pinned");
    assert_eq!(
        runtime.set_pinned(1_003, &pinned_id, true).expect("pin"),
        PinOutcome::Updated
    );
    assert!(runtime.delete(&id("delete by id")).expect("delete"));
    assert_eq!(runtime.clear(ClearScope::Unpinned).expect("clear"), 1);
    drop(runtime);

    let reopened = ClipboardRuntime::open(
        path,
        protector,
        Arc::new(FakeClipboardBackend::default()),
        ClipboardPolicy::default(),
    )
    .expect("runtime should reopen");
    let snapshot = reopened.snapshot(1_004, 0, 10).expect("snapshot");
    assert_eq!(snapshot.total_entries, 1);
    assert_eq!(snapshot.entries[0].id, pinned_id);
    assert!(snapshot.entries[0].pinned);
}

#[test]
fn clearing_more_than_one_page_removes_all_rows_from_disk() {
    let directory = TestDirectory::new("clear-multiple-pages");
    let path = directory.database();
    let protector = Arc::new(ToggleProtector::default());
    let backend = Arc::new(FakeClipboardBackend::default());
    let runtime = ClipboardRuntime::open(
        path.clone(),
        protector.clone(),
        backend.clone(),
        ClipboardPolicy::default(),
    )
    .expect("runtime should open");
    runtime.set_enabled(true).expect("listener should start");
    for index in 0..101 {
        backend.emit(ObservedClipboardText {
            text: format!("synthetic entry {index}"),
            observed_at_ms: 1_000 + index,
            source_app_id: None,
            exclude_from_history: false,
            restore_marker: None,
        });
    }

    assert_eq!(runtime.clear(ClearScope::All).expect("clear"), 101);
    assert_eq!(
        runtime
            .snapshot(1_101, 0, 10)
            .expect("snapshot")
            .total_entries,
        0
    );
    let disk = ClipboardStore::open(path, protector).expect("store should reopen");
    assert!(disk
        .load_snapshot()
        .expect("disk snapshot")
        .entries
        .is_empty());
}

#[test]
fn reopen_orders_same_timestamp_entries_by_numeric_capture_sequence() {
    let directory = TestDirectory::new("same-time-order");
    let path = directory.database();
    let protector = Arc::new(ToggleProtector::default());
    let store = ClipboardStore::open(path.clone(), protector.clone()).expect("store should open");
    let policy = enabled_policy();
    let mut history = ClipboardHistory::new();
    for index in 0..10 {
        let (outcome, entry) = inserted_entry(
            &mut history,
            &policy,
            &format!("same timestamp {index}"),
            1_000,
        );
        store
            .apply_capture(&outcome, Some(&entry))
            .expect("persist capture");
    }
    drop(store);

    let runtime = ClipboardRuntime::open(
        path,
        protector,
        Arc::new(FakeClipboardBackend::default()),
        ClipboardPolicy::default(),
    )
    .expect("runtime should reopen");
    let entries = runtime.snapshot(1_000, 0, 10).expect("snapshot").entries;
    assert_eq!(entries[0].text, "same timestamp 9");
    assert_eq!(entries[0].id, "clip-10");
}

#[cfg(windows)]
#[test]
fn native_text_decoder_rejects_oversized_or_unterminated_utf16() {
    use super::windows_backend::decode_text;

    assert_eq!(decode_text(&[65, 13, 10, 66, 0], 4), Some("A\r\nB".into()));
    assert_eq!(decode_text(&[65, 0], 0), None);
    assert_eq!(decode_text(&[65, 66, 0], 1), None);
    assert_eq!(decode_text(&[65, 66], 4), None);
    assert_eq!(decode_text(&[0xD800, 0], 4), None);
}

#[cfg(windows)]
#[test]
fn native_restore_echo_requires_both_sequence_and_own_marker() {
    use super::windows_backend::is_restore_echo;

    assert!(is_restore_echo(
        12,
        Some("widget-platform:1:2"),
        Some((12, "widget-platform:1:2"))
    ));
    assert!(!is_restore_echo(
        13,
        Some("widget-platform:1:2"),
        Some((12, "widget-platform:1:2"))
    ));
    assert!(!is_restore_echo(
        12,
        None,
        Some((12, "widget-platform:1:2"))
    ));
    assert!(!is_restore_echo(
        12,
        Some("other"),
        Some((12, "widget-platform:1:2"))
    ));
}

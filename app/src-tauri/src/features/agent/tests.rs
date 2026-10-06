use super::{
    AgentSessionEvent, AgentSessionReducer, AgentSessionSnapshot, AgentSessionStatus,
    AgentStatusQuality, AgentStatusSource,
};

fn started(
    session_id: &str,
    turn_id: &str,
    provider: &str,
    observed_at_ms: i64,
) -> AgentSessionEvent {
    AgentSessionEvent::TurnStarted {
        session_id: session_id.to_owned(),
        turn_id: turn_id.to_owned(),
        provider: Some(provider.to_owned()),
        observed_at_ms,
    }
}

fn ended(
    session_id: &str,
    turn_id: Option<&str>,
    completed: bool,
    failed: bool,
    interrupted: bool,
    observed_at_ms: i64,
) -> AgentSessionEvent {
    AgentSessionEvent::TurnEnded {
        session_id: session_id.to_owned(),
        turn_id: turn_id.map(str::to_owned),
        completed,
        failed,
        interrupted,
        observed_at_ms,
    }
}

#[test]
fn turn_start_marks_the_session_working_with_safe_metadata_only() {
    let mut reducer = AgentSessionReducer::new("session-a".to_owned()).expect("valid session id");
    assert!(reducer.apply(started("session-a", "turn-1", "openai-codex", 100)));

    let snapshot: AgentSessionSnapshot = reducer.snapshot(100, 1_000).expect("observed snapshot");
    assert_eq!(snapshot.source, AgentStatusSource::Hermes);
    assert_eq!(snapshot.session_id, "session-a");
    assert_eq!(snapshot.provider.as_deref(), Some("openai-codex"));
    assert_eq!(snapshot.status, AgentSessionStatus::Working);
    assert_eq!(snapshot.quality, AgentStatusQuality::Observed);
    assert_eq!(snapshot.observed_at_ms, 100);

    let json = serde_json::to_value(snapshot).expect("serialize status snapshot");
    assert!(json.get("sessionId").is_some());
    assert!(json.get("observedAtMs").is_some());
    assert!(json.get("prompt").is_none());
    assert!(json.get("response").is_none());
}

#[test]
fn completed_turn_waits_for_the_user_instead_of_claiming_done() {
    let mut reducer = AgentSessionReducer::new("session-a".to_owned()).expect("valid session id");
    assert!(reducer.apply(started("session-a", "turn-1", "openai-codex", 100)));
    assert!(reducer.apply(ended("session-a", Some("turn-1"), true, false, false, 200)));

    let snapshot = reducer.snapshot(200, 1_000).expect("observed snapshot");
    assert_eq!(snapshot.status, AgentSessionStatus::Waiting);
    assert_ne!(snapshot.status, AgentSessionStatus::Done);
}

#[test]
fn failed_turn_is_reported_as_failed() {
    let mut reducer = AgentSessionReducer::new("session-a".to_owned()).expect("valid session id");
    assert!(reducer.apply(started("session-a", "turn-1", "openai-codex", 100)));
    assert!(reducer.apply(ended("session-a", Some("turn-1"), false, true, false, 200)));

    let snapshot = reducer.snapshot(200, 1_000).expect("observed snapshot");
    assert_eq!(snapshot.status, AgentSessionStatus::Failed);
}

#[test]
fn interrupted_turn_is_reported_as_cancelled() {
    let mut reducer = AgentSessionReducer::new("session-a".to_owned()).expect("valid session id");
    assert!(reducer.apply(started("session-a", "turn-1", "openai-codex", 100)));
    assert!(reducer.apply(ended("session-a", Some("turn-1"), false, false, true, 200)));

    let snapshot = reducer.snapshot(200, 1_000).expect("observed snapshot");
    assert_eq!(snapshot.status, AgentSessionStatus::Cancelled);
}

#[test]
fn ambiguous_turn_end_becomes_unknown_not_done() {
    let mut reducer = AgentSessionReducer::new("session-a".to_owned()).expect("valid session id");
    assert!(reducer.apply(started("session-a", "turn-1", "openai-codex", 100)));
    assert!(reducer.apply(ended("session-a", Some("turn-1"), false, false, false, 200)));

    let snapshot = reducer.snapshot(200, 1_000).expect("observed snapshot");
    assert_eq!(snapshot.status, AgentSessionStatus::Unknown);
    assert_ne!(snapshot.status, AgentSessionStatus::Done);
}

#[test]
fn stale_session_becomes_unknown_without_rewriting_observation_time() {
    let mut reducer = AgentSessionReducer::new("session-a".to_owned()).expect("valid session id");
    assert!(reducer.apply(started("session-a", "turn-1", "openai-codex", 100)));

    let snapshot = reducer.snapshot(1_100, 1_000).expect("stale snapshot");
    assert_eq!(snapshot.status, AgentSessionStatus::Unknown);
    assert_eq!(snapshot.quality, AgentStatusQuality::Stale);
    assert_eq!(snapshot.observed_at_ms, 100);
}

#[test]
fn delayed_end_from_an_older_turn_does_not_overwrite_the_active_turn() {
    let mut reducer = AgentSessionReducer::new("session-a".to_owned()).expect("valid session id");
    assert!(reducer.apply(started("session-a", "turn-1", "openai-codex", 100)));
    assert!(reducer.apply(ended("session-a", Some("turn-1"), true, false, false, 200)));
    assert!(reducer.apply(started("session-a", "turn-2", "openai-codex", 300)));

    assert!(!reducer.apply(ended("session-a", Some("turn-1"), true, false, false, 400)));
    let snapshot = reducer.snapshot(400, 1_000).expect("current snapshot");
    assert_eq!(snapshot.status, AgentSessionStatus::Working);
    assert_eq!(snapshot.observed_at_ms, 300);
}

#[test]
fn delayed_end_from_a_prior_turn_is_ignored_after_a_newer_turn_finishes() {
    let mut reducer = AgentSessionReducer::new("session-a".to_owned()).expect("valid session id");
    assert!(reducer.apply(started("session-a", "turn-1", "openai-codex", 100)));
    assert!(reducer.apply(ended("session-a", Some("turn-1"), true, false, false, 200)));
    assert!(reducer.apply(started("session-a", "turn-2", "openai-codex", 300)));
    assert!(reducer.apply(ended("session-a", Some("turn-2"), true, false, false, 400)));

    assert!(!reducer.apply(ended("session-a", Some("turn-1"), false, true, false, 500)));
    let snapshot = reducer.snapshot(500, 1_000).expect("current snapshot");
    assert_eq!(snapshot.status, AgentSessionStatus::Waiting);
    assert_eq!(snapshot.observed_at_ms, 400);
}

#[test]
fn delayed_start_for_a_completed_turn_is_ignored_after_a_newer_turn_finishes() {
    let mut reducer = AgentSessionReducer::new("session-a".to_owned()).expect("valid session id");
    assert!(reducer.apply(started("session-a", "turn-1", "openai-codex", 100)));
    assert!(reducer.apply(ended("session-a", Some("turn-1"), true, false, false, 200)));
    assert!(reducer.apply(started("session-a", "turn-2", "openai-codex", 300)));
    assert!(reducer.apply(ended("session-a", Some("turn-2"), true, false, false, 400)));

    assert!(!reducer.apply(started("session-a", "turn-1", "openai-codex", 500)));
    let snapshot = reducer.snapshot(500, 1_000).expect("current snapshot");
    assert_eq!(snapshot.status, AgentSessionStatus::Waiting);
    assert_eq!(snapshot.observed_at_ms, 400);
}

#[test]
fn separate_session_reducers_do_not_share_status() {
    let mut first = AgentSessionReducer::new("session-a".to_owned()).expect("valid session id");
    let mut second = AgentSessionReducer::new("session-b".to_owned()).expect("valid session id");
    assert!(first.apply(started("session-a", "turn-1", "openai-codex", 100)));
    assert!(second.apply(started("session-b", "turn-2", "openai-codex", 110)));
    assert!(first.apply(ended("session-a", Some("turn-1"), true, false, false, 200)));

    assert_eq!(
        first.snapshot(200, 1_000).expect("first snapshot").status,
        AgentSessionStatus::Waiting
    );
    assert_eq!(
        second.snapshot(200, 1_000).expect("second snapshot").status,
        AgentSessionStatus::Working
    );
}

#[test]
fn reducer_rejects_events_for_a_different_or_invalid_session_id() {
    assert!(AgentSessionReducer::new(String::new()).is_none());
    let mut reducer = AgentSessionReducer::new("session-a".to_owned()).expect("valid session id");

    assert!(!reducer.apply(started("session-b", "turn-1", "openai-codex", 100)));
    assert!(!reducer.apply(started("session-a", "", "openai-codex", 100)));
    assert!(!reducer.apply(started("session-a", "turn-1", "openai-codex", -1)));
}

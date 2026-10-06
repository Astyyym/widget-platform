use super::model::{
    artwork_length, artwork_reference, dispatch_media_control, duration_100ns_to_ms,
    error_kind_from_hresult, normalize_metadata, ArtworkError, MediaBridgeError, MediaCapabilities,
    MediaControlAction, MediaErrorKind, MediaSession, MediaTimeline, ValidatedMediaControl,
    MAX_ARTWORK_BYTES, MAX_METADATA_CHARS,
};

fn controllable_session() -> MediaSession {
    MediaSession {
        session_id: "media-session-1".to_string(),
        timeline: MediaTimeline {
            start_ms: Some(1_000),
            end_ms: Some(11_000),
            position_ms: Some(4_000),
        },
        capabilities: MediaCapabilities {
            can_play: Some(true),
            can_pause: Some(true),
            can_previous: Some(true),
            can_next: Some(true),
            can_seek: Some(true),
        },
        ..MediaSession::default()
    }
}

#[test]
fn media_control_targets_only_the_validated_action_and_keeps_false_results() {
    let session = controllable_session();
    let mut invoked = None;
    let result = dispatch_media_control(&session, MediaControlAction::Next, None, |request| {
        invoked = Some(request);
        Ok(false)
    });

    assert_eq!(result, Ok(false));
    assert_eq!(
        invoked,
        Some(ValidatedMediaControl {
            action: MediaControlAction::Next,
            position_ticks: None,
        })
    );
}

#[test]
fn media_control_preserves_provider_errors_and_success_results() {
    let session = controllable_session();
    assert_eq!(
        dispatch_media_control(&session, MediaControlAction::Play, None, |_| Ok(true)),
        Ok(true)
    );
    assert_eq!(
        dispatch_media_control(&session, MediaControlAction::Pause, None, |_| {
            Err(MediaBridgeError::ControlFailed)
        }),
        Err(MediaBridgeError::ControlFailed)
    );
}

#[test]
fn media_control_requires_true_capability_and_valid_action_arguments() {
    let mut session = controllable_session();
    session.capabilities.can_next = None;
    assert_eq!(
        dispatch_media_control(&session, MediaControlAction::Next, None, |_| Ok(true)),
        Err(MediaBridgeError::ControlUnsupported)
    );

    session.capabilities.can_next = Some(false);
    assert_eq!(
        dispatch_media_control(&session, MediaControlAction::Next, None, |_| Ok(true)),
        Err(MediaBridgeError::ControlUnsupported)
    );
    assert_eq!(
        dispatch_media_control(&session, MediaControlAction::Seek, None, |_| Ok(true)),
        Err(MediaBridgeError::InvalidControlRequest)
    );
    assert_eq!(
        dispatch_media_control(&session, MediaControlAction::Play, Some(500), |_| Ok(true)),
        Err(MediaBridgeError::InvalidControlRequest)
    );
}

#[test]
fn media_seek_clamps_relative_milliseconds_and_converts_to_100ns_ticks() {
    let session = controllable_session();
    let mut invoked = None;
    let result = dispatch_media_control(
        &session,
        MediaControlAction::Seek,
        Some(u64::MAX),
        |request| {
            invoked = Some(request);
            Ok(true)
        },
    );

    assert_eq!(result, Ok(true));
    assert_eq!(
        invoked,
        Some(ValidatedMediaControl {
            action: MediaControlAction::Seek,
            position_ticks: Some(110_000_000),
        })
    );
}

#[test]
fn metadata_omits_empty_values_and_bounds_untrusted_text() {
    assert_eq!(normalize_metadata(" \r\n\t "), None);
    assert_eq!(normalize_metadata("  title  "), Some("title".to_string()));

    let oversized = "音".repeat(MAX_METADATA_CHARS + 20);
    let normalized = normalize_metadata(&oversized).expect("non-empty metadata");
    assert_eq!(normalized.chars().count(), MAX_METADATA_CHARS);
}

#[test]
fn timeline_conversion_uses_100ns_units_and_rejects_negative_values() {
    assert_eq!(duration_100ns_to_ms(12_345_678), Some(1_234));
    assert_eq!(duration_100ns_to_ms(9_999), Some(0));
    assert_eq!(duration_100ns_to_ms(-1), None);
}

#[test]
fn artwork_size_is_bounded_before_allocation() {
    assert_eq!(artwork_length(0), Err(ArtworkError::Empty));
    assert_eq!(artwork_length(1), Ok(1));
    assert_eq!(
        artwork_length(MAX_ARTWORK_BYTES),
        Ok(MAX_ARTWORK_BYTES as usize)
    );
    assert_eq!(
        artwork_length(MAX_ARTWORK_BYTES + 1),
        Err(ArtworkError::TooLarge)
    );
}

#[test]
fn artwork_references_are_separate_from_metadata_and_change_on_revision() {
    assert_eq!(artwork_reference("session-7", 1), "session-7/artwork/1");
    assert_ne!(
        artwork_reference("session-7", 1),
        artwork_reference("session-7", 2)
    );
}

#[test]
fn access_denied_is_classified_without_exposing_provider_text() {
    assert_eq!(
        error_kind_from_hresult(0x8007_0005u32 as i32),
        MediaErrorKind::AccessDenied
    );
    assert_eq!(
        error_kind_from_hresult(0x8000_4005u32 as i32),
        MediaErrorKind::ProviderUnavailable
    );
}

#[cfg(target_os = "windows")]
#[test]
fn current_session_source_fallback_only_matches_a_unique_source() {
    use super::MediaSession;

    fn session(id: &str, source: &str) -> MediaSession {
        MediaSession {
            session_id: id.to_string(),
            source_app_user_model_id: Some(source.to_string()),
            ..MediaSession::default()
        }
    }

    let distinct = vec![
        session("music", "cloudmusic.exe"),
        session("edge", "MSEdge"),
    ];
    assert_eq!(
        super::winrt::unique_session_id_for_source(distinct.iter(), "msedge"),
        Some("edge".to_string())
    );

    let duplicate_source = vec![session("tab-1", "MSEdge"), session("tab-2", "msedge")];
    assert_eq!(
        super::winrt::unique_session_id_for_source(duplicate_source.iter(), "MSEdge"),
        None
    );
}

#[cfg(target_os = "windows")]
#[test]
fn session_identity_source_fallback_reuses_only_a_unique_entry() {
    let unique = [(7, Some("cloudmusic.exe")), (12, Some("MSEdge"))];
    assert_eq!(
        super::winrt::unique_session_identity_for_source(unique.into_iter(), "msedge"),
        Some(12)
    );

    let ambiguous = [(7, Some("MSEdge")), (12, Some("msedge"))];
    assert_eq!(
        super::winrt::unique_session_identity_for_source(ambiguous.into_iter(), "MSEdge"),
        None
    );
}

/// This manual E2 probe is ignored in every normal test run. It must not start
/// GSMTC until the operator supplies an explicit read-only authorization, an
/// allowlist marker for the dedicated test source(s), and confirms that no
/// unrelated media sessions are active. It never sends transport controls.
#[cfg(target_os = "windows")]
#[test]
#[ignore = "requires explicit authorization for dedicated GSMTC test sessions"]
fn live_gsmtc_authorized_read_only_probe() {
    use super::{MediaMonitor, MediaPlaybackState};
    use std::collections::{BTreeSet, HashMap};
    use std::env;
    use std::thread;
    use std::time::{Duration, Instant};

    assert_eq!(
        env::var("G4_A_MEDIA_READ_AUTHORIZED").ok().as_deref(),
        Some("YES"),
        "refusing to start GSMTC without explicit read-only authorization"
    );
    assert_eq!(
        env::var("G4_A_NO_UNRELATED_MEDIA_SESSIONS").ok().as_deref(),
        Some("YES"),
        "close unrelated media sessions before starting the GSMTC probe"
    );

    let source_markers: Vec<String> = env::var("G4_A_ALLOWED_AUMID_MARKERS")
        .expect("set one or more semicolon-separated test-source AUMID markers")
        .split(';')
        .map(str::trim)
        .filter(|marker| !marker.is_empty())
        .map(str::to_lowercase)
        .collect();
    assert!(
        !source_markers.is_empty() && source_markers.len() <= 2,
        "provide one or two user-authorized test-source AUMID markers"
    );

    let duration_seconds = env::var("G4_A_PROBE_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(180);
    assert!((30..=300).contains(&duration_seconds));
    let require_artwork_issue = match env::var("G4_A_REQUIRE_ARTWORK_ISSUE").as_deref() {
        Ok("YES") => true,
        Ok("NO") | Err(_) => false,
        Ok(_) => panic!("G4_A_REQUIRE_ARTWORK_ISSUE must be YES or NO"),
    };

    let monitor = MediaMonitor::start().expect("start the read-only GSMTC monitor");
    eprintln!(
        "G4-A read-only probe started for {duration_seconds}s; manually switch, pause, and close only the authorized test sessions"
    );

    let started = Instant::now();
    let mut seen_session_ids = BTreeSet::<String>::new();
    let mut removed_session_ids = BTreeSet::<String>::new();
    let mut authorized_source_ids = BTreeSet::<String>::new();
    let mut last_signatures = HashMap::<String, String>::new();
    let mut requested_artwork = BTreeSet::<String>::new();
    let mut no_artwork_reference = BTreeSet::<String>::new();
    let mut last_current_session: Option<String> = None;
    let mut last_session_ids_by_source = HashMap::<String, BTreeSet<String>>::new();
    let mut current_session_switches = 0usize;
    let mut session_identity_churns = 0usize;
    let mut saw_paused = false;
    let mut saw_closed_or_removed = false;
    let mut saw_artwork_issue_with_text = false;
    let mut last_health = None;

    while started.elapsed() < Duration::from_secs(duration_seconds) {
        let snapshot = monitor.snapshot();
        let health = (snapshot.health, snapshot.error);
        if last_health != Some(health) {
            eprintln!(
                "G4-A health {}",
                serde_json::json!({
                    "observedAtMs": snapshot.observed_at_ms,
                    "health": snapshot.health,
                    "error": snapshot.error,
                })
            );
            last_health = Some(health);
        }

        let mut active_authorized_ids = BTreeSet::<String>::new();
        let mut active_session_ids_by_source = HashMap::<String, BTreeSet<String>>::new();
        for session in &snapshot.sessions {
            let source_id = session.source_app_user_model_id.as_deref();
            let matches_allowlist = source_id.is_some_and(|source_id| {
                let source_id = source_id.to_lowercase();
                source_markers
                    .iter()
                    .any(|marker| source_id.contains(marker))
            });
            let was_authorized = seen_session_ids.contains(&session.session_id);
            if !matches_allowlist && !was_authorized {
                continue;
            }

            seen_session_ids.insert(session.session_id.clone());
            active_authorized_ids.insert(session.session_id.clone());
            if let Some(source_id) = source_id {
                authorized_source_ids.insert(source_id.to_string());
                active_session_ids_by_source
                    .entry(source_id.to_lowercase())
                    .or_default()
                    .insert(session.session_id.clone());
            }
            saw_paused |= session.playback_state == Some(MediaPlaybackState::Paused);
            saw_closed_or_removed |= session.playback_state == Some(MediaPlaybackState::Closed);
            let is_current =
                snapshot.current_session_id.as_deref() == Some(session.session_id.as_str());

            let signature = serde_json::json!({
                "sourceAppUserModelId": source_id,
                "titlePresent": session.title.is_some(),
                "artistPresent": session.artist.is_some(),
                "albumTitlePresent": session.album_title.is_some(),
                "playbackState": session.playback_state,
                "timeline": {
                    "startMs": session.timeline.start_ms,
                    "endMs": session.timeline.end_ms,
                    "positionBucket5s": session.timeline.position_ms.map(|position| position / 5_000),
                },
                "capabilities": session.capabilities,
                "quality": session.quality,
                "artworkRefPresent": session.artwork_ref.is_some(),
                "isCurrentSession": is_current,
            })
            .to_string();
            if last_signatures.get(&session.session_id) != Some(&signature) {
                eprintln!(
                    "G4-A authorized session {}",
                    serde_json::json!({
                        "observedAtMs": snapshot.observed_at_ms,
                        "sessionId": session.session_id,
                        "sourceAppUserModelId": source_id,
                        "titlePresent": session.title.is_some(),
                        "artistPresent": session.artist.is_some(),
                        "albumTitlePresent": session.album_title.is_some(),
                        "playbackState": session.playback_state,
                        "timeline": session.timeline,
                        "capabilities": session.capabilities,
                        "quality": session.quality,
                        "isCurrentSession": is_current,
                    })
                );
                last_signatures.insert(session.session_id.clone(), signature);
            }

            if let Some(reference) = session.artwork_ref.as_deref() {
                if requested_artwork.insert(reference.to_string()) {
                    let outcome = match monitor.request_artwork(reference) {
                        Ok(job) => match job.wait_timeout(Duration::from_secs(5)) {
                            Ok(Some(data)) => serde_json::json!({
                                "status": "read",
                                "contentType": data.content_type,
                                "byteLength": data.bytes.len(),
                            }),
                            Ok(None) => serde_json::json!({ "status": "timedOut" }),
                            Err(error) => serde_json::json!({
                                "status": "failed",
                                "error": format!("{error:?}"),
                            }),
                        },
                        Err(error) => serde_json::json!({
                            "status": "notStarted",
                            "error": format!("{error:?}"),
                        }),
                    };
                    eprintln!(
                        "G4-A authorized artwork {}",
                        serde_json::json!({
                            "observedAtMs": snapshot.observed_at_ms,
                            "sessionId": session.session_id,
                            "outcome": &outcome,
                        })
                    );
                    if outcome.get("status").and_then(|status| status.as_str()) != Some("read")
                        && (session.title.is_some() || session.artist.is_some())
                    {
                        saw_artwork_issue_with_text = true;
                    }
                }
            } else if no_artwork_reference.insert(session.session_id.clone()) {
                eprintln!(
                    "G4-A authorized artwork unavailable {}",
                    serde_json::json!({
                        "observedAtMs": snapshot.observed_at_ms,
                        "sessionId": session.session_id,
                        "referencePresent": false,
                    })
                );
                saw_artwork_issue_with_text |= session.title.is_some() || session.artist.is_some();
            }
        }

        if let Some(current_id) = snapshot
            .current_session_id
            .as_ref()
            .filter(|session_id| active_authorized_ids.contains(*session_id))
        {
            if let Some(previous_id) = &last_current_session {
                if previous_id != current_id {
                    current_session_switches += 1;
                    eprintln!(
                        "G4-A authorized current-session switch {}",
                        serde_json::json!({
                            "observedAtMs": snapshot.observed_at_ms,
                            "fromSessionId": previous_id,
                            "toSessionId": current_id,
                        })
                    );
                }
            }
            last_current_session = Some(current_id.clone());
        }

        for session_id in &seen_session_ids {
            if !active_authorized_ids.contains(session_id)
                && removed_session_ids.insert(session_id.clone())
            {
                saw_closed_or_removed = true;
                eprintln!(
                    "G4-A authorized session removed {}",
                    serde_json::json!({
                        "observedAtMs": snapshot.observed_at_ms,
                        "sessionId": session_id,
                    })
                );
            }
        }

        for (source_id, current_ids) in &active_session_ids_by_source {
            if last_session_ids_by_source
                .get(source_id)
                .is_some_and(|previous_ids| previous_ids.is_disjoint(current_ids))
            {
                session_identity_churns += 1;
                eprintln!(
                    "G4-A authorized source session identity changed {}",
                    serde_json::json!({
                        "observedAtMs": snapshot.observed_at_ms,
                        "sourceAppUserModelId": source_id,
                    })
                );
            }
        }
        last_session_ids_by_source = active_session_ids_by_source;

        if seen_session_ids.len() >= 2
            && current_session_switches > 0
            && saw_paused
            && saw_closed_or_removed
            && (!require_artwork_issue || saw_artwork_issue_with_text)
        {
            break;
        }
        thread::sleep(Duration::from_millis(500));
    }

    eprintln!("G4-A stopping read-only monitor");
    monitor.stop();
    eprintln!("G4-A read-only monitor stopped");
    eprintln!(
        "G4-A read-only probe summary {}",
        serde_json::json!({
            "distinctAuthorizedSessions": seen_session_ids.len(),
            "authorizedSourceIds": authorized_source_ids,
            "currentSessionSwitches": current_session_switches,
            "sessionIdentityChurns": session_identity_churns,
            "sawPaused": saw_paused,
            "sawClosedOrRemoved": saw_closed_or_removed,
            "sawArtworkIssueWithText": saw_artwork_issue_with_text,
            "requireArtworkIssue": require_artwork_issue,
            "artworkReferencesRead": requested_artwork.len(),
            "sessionsWithoutArtworkReference": no_artwork_reference.len(),
            "monitorStopped": true,
        })
    );

    assert!(
        seen_session_ids.len() >= 2,
        "did not observe two authorized sessions"
    );
    assert_eq!(
        session_identity_churns, 0,
        "session IDs changed while an authorized source remained active"
    );
    assert!(
        current_session_switches > 0,
        "did not observe a current-session switch"
    );
    assert!(saw_paused, "did not observe a paused authorized session");
    assert!(
        saw_closed_or_removed,
        "did not observe an authorized session close/removal"
    );
    if require_artwork_issue {
        assert!(
            saw_artwork_issue_with_text,
            "did not observe missing/failed artwork alongside authorized text metadata"
        );
    }
}

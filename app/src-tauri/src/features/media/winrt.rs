use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use windows::core::{IUnknown, Interface, Result as WinResult};
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as GsmtcSession,
    GlobalSystemMediaTransportControlsSessionManager as GsmtcManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as GsmtcPlaybackStatus,
};
use windows::Storage::Streams::{
    Buffer, DataReader, IRandomAccessStreamReference, InputStreamOptions,
};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
use windows_future::AsyncStatus;

use super::model::{
    artwork_length, artwork_reference, dispatch_media_control, duration_100ns_to_ms,
    error_kind_from_hresult, normalize_metadata, ArtworkError, MediaBridgeError, MediaCapabilities,
    MediaControlAction, MediaErrorKind, MediaHealth, MediaPlaybackState, MediaSession,
    MediaSnapshot, MediaTimeline, ValidatedMediaControl,
};

const EVENT_QUEUE_CAPACITY: usize = 128;
const EVENT_WAIT: Duration = Duration::from_millis(250);
const OPERATION_TIMEOUT: Duration = Duration::from_secs(4);

struct ComApartment;

impl ComApartment {
    fn initialize() -> Result<Self, i32> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|error| error.code().0)?;
        Ok(Self)
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

#[derive(Clone, Copy)]
enum SessionSection {
    Metadata,
    Timeline,
    Playback,
}

enum NativeEvent {
    SessionsChanged,
    CurrentSessionChanged,
    SessionChanged {
        identity: usize,
        section: SessionSection,
    },
}

enum WorkerMessage {
    Event(NativeEvent),
    ReadArtwork {
        reference: String,
        cancelled: Arc<AtomicBool>,
        response: mpsc::Sender<Result<ArtworkData, MediaBridgeError>>,
    },
    Control {
        session_id: String,
        action: MediaControlAction,
        position_ms: Option<u64>,
        cancelled: Arc<AtomicBool>,
        response: mpsc::Sender<Result<bool, MediaBridgeError>>,
    },
}

#[derive(Default)]
struct SessionTokens {
    playback: Option<i64>,
    metadata: Option<i64>,
    timeline: Option<i64>,
}

#[derive(Default)]
struct ManagerTokens {
    sessions: Option<i64>,
    current: Option<i64>,
}

struct SessionEntry {
    id: String,
    session: GsmtcSession,
    tokens: SessionTokens,
    public: MediaSession,
    artwork: Option<IRandomAccessStreamReference>,
    artwork_revision: u64,
    failed_fields: u8,
}

impl SessionEntry {
    fn new(id: String, session: GsmtcSession, tokens: SessionTokens) -> Self {
        let mut entry = Self {
            public: MediaSession {
                session_id: id.clone(),
                quality: MediaHealth::Partial,
                ..MediaSession::default()
            },
            id,
            session,
            tokens,
            artwork: None,
            artwork_revision: 0,
            failed_fields: 0,
        };
        if entry.tokens.playback.is_none()
            || entry.tokens.metadata.is_none()
            || entry.tokens.timeline.is_none()
        {
            entry.failed_fields |= 0b1000;
        }
        entry.refresh_source_id();
        entry
    }

    fn refresh_source_id(&mut self) {
        match self.session.SourceAppUserModelId() {
            Ok(value) => {
                self.public.source_app_user_model_id = normalize_metadata(&value.to_string());
                self.failed_fields &= !0b1_0000;
            }
            Err(_) => self.failed_fields |= 0b1_0000,
        }
    }

    fn refresh_metadata(&mut self, stop: &AtomicBool, local_cancel: Option<&AtomicBool>) {
        self.refresh_source_id();
        let result = match self.session.TryGetMediaPropertiesAsync() {
            Ok(operation) => wait_for_operation(
                || {
                    stop.load(Ordering::Acquire)
                        || local_cancel.is_some_and(|flag| flag.load(Ordering::Acquire))
                },
                || operation.Status().map_err(|error| error.code().0),
                || operation.Cancel().map_err(|error| error.code().0),
                || operation.GetResults().map_err(|error| error.code().0),
            ),
            Err(_) => Err(MediaBridgeError::ProviderUnavailable),
        };

        match result {
            Ok(properties) => {
                let mut failed = false;
                self.public.title = read_metadata(properties.Title(), &mut failed);
                self.public.artist = read_metadata(properties.Artist(), &mut failed);
                self.public.album_title = read_metadata(properties.AlbumTitle(), &mut failed);

                self.artwork_revision = self.artwork_revision.saturating_add(1);
                self.artwork = properties.Thumbnail().ok();
                self.public.artwork_ref = self
                    .artwork
                    .as_ref()
                    .map(|_| artwork_reference(&self.id, self.artwork_revision));

                if failed {
                    self.failed_fields |= 0b1;
                } else {
                    self.failed_fields &= !0b1;
                }
            }
            Err(error) => {
                self.failed_fields |= 0b1;
                if error == MediaBridgeError::Stopped {
                    return;
                }
            }
        }
        self.update_quality();
    }

    fn refresh_timeline(&mut self) {
        match self.session.GetTimelineProperties() {
            Ok(timeline) => {
                self.public.timeline = MediaTimeline {
                    start_ms: timeline
                        .StartTime()
                        .ok()
                        .and_then(|value| duration_100ns_to_ms(value.Duration)),
                    end_ms: timeline
                        .EndTime()
                        .ok()
                        .and_then(|value| duration_100ns_to_ms(value.Duration)),
                    position_ms: timeline
                        .Position()
                        .ok()
                        .and_then(|value| duration_100ns_to_ms(value.Duration)),
                };
                self.failed_fields &= !0b10;
            }
            Err(_) => self.failed_fields |= 0b10,
        }
        self.update_quality();
    }

    fn refresh_playback(&mut self) {
        match self.session.GetPlaybackInfo() {
            Ok(info) => {
                self.public.playback_state = info.PlaybackStatus().ok().map(playback_state);
                match info.Controls() {
                    Ok(controls) => {
                        self.public.capabilities = MediaCapabilities {
                            can_play: controls.IsPlayEnabled().ok(),
                            can_pause: controls.IsPauseEnabled().ok(),
                            can_previous: controls.IsPreviousEnabled().ok(),
                            can_next: controls.IsNextEnabled().ok(),
                            can_seek: controls.IsPlaybackPositionEnabled().ok(),
                        };
                        if self.public.playback_state.is_some()
                            && self.public.capabilities.can_play.is_some()
                            && self.public.capabilities.can_pause.is_some()
                            && self.public.capabilities.can_previous.is_some()
                            && self.public.capabilities.can_next.is_some()
                            && self.public.capabilities.can_seek.is_some()
                        {
                            self.failed_fields &= !0b100;
                        } else {
                            self.failed_fields |= 0b100;
                        }
                    }
                    Err(_) => {
                        self.public.playback_state = None;
                        self.public.capabilities = MediaCapabilities::default();
                        self.failed_fields |= 0b100;
                    }
                }
            }
            Err(_) => {
                self.public.playback_state = None;
                self.public.capabilities = MediaCapabilities::default();
                self.failed_fields |= 0b100;
            }
        }
        self.update_quality();
    }

    fn refresh_all(&mut self, stop: &AtomicBool) {
        self.refresh_metadata(stop, None);
        if !stop.load(Ordering::Acquire) {
            self.refresh_timeline();
            self.refresh_playback();
        }
    }

    fn update_quality(&mut self) {
        self.public.quality = if self.failed_fields == 0 {
            MediaHealth::Available
        } else {
            MediaHealth::Partial
        };
    }

    fn remove_handlers(&self) {
        if let Some(token) = self.tokens.playback {
            let _ = self.session.RemovePlaybackInfoChanged(token);
        }
        if let Some(token) = self.tokens.metadata {
            let _ = self.session.RemoveMediaPropertiesChanged(token);
        }
        if let Some(token) = self.tokens.timeline {
            let _ = self.session.RemoveTimelinePropertiesChanged(token);
        }
    }
}

pub struct ArtworkData {
    pub content_type: String,
    pub bytes: Vec<u8>,
}

pub struct ArtworkJob {
    cancelled: Arc<AtomicBool>,
    response: Receiver<Result<ArtworkData, MediaBridgeError>>,
}

pub struct MediaControlJob {
    cancelled: Arc<AtomicBool>,
    response: Receiver<Result<bool, MediaBridgeError>>,
}

impl MediaControlJob {
    pub fn wait_timeout(&self, timeout: Duration) -> Result<bool, MediaBridgeError> {
        match self.response.recv_timeout(timeout) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => {
                self.cancelled.store(true, Ordering::Release);
                Err(MediaBridgeError::OperationTimedOut)
            }
            Err(RecvTimeoutError::Disconnected) => Err(MediaBridgeError::ProviderUnavailable),
        }
    }
}

impl Drop for MediaControlJob {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
    }
}

impl ArtworkJob {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn wait_timeout(&self, timeout: Duration) -> Result<Option<ArtworkData>, MediaBridgeError> {
        match self.response.recv_timeout(timeout) {
            Ok(result) => result.map(Some),
            Err(RecvTimeoutError::Timeout) => Ok(None),
            Err(RecvTimeoutError::Disconnected) => Err(MediaBridgeError::ProviderUnavailable),
        }
    }
}

impl Drop for ArtworkJob {
    fn drop(&mut self) {
        self.cancel();
    }
}

pub struct MediaMonitor {
    stop: Arc<AtomicBool>,
    full_refresh: Arc<AtomicBool>,
    sender: SyncSender<WorkerMessage>,
    snapshot: Arc<RwLock<MediaSnapshot>>,
    worker: Option<JoinHandle<()>>,
}

impl MediaMonitor {
    /// Explicitly starts a read-only GSMTC monitor. Construction does not
    /// happen as part of app startup; a future visible media consumer owns it.
    pub fn start() -> Result<Self, MediaBridgeError> {
        let (sender, receiver) = mpsc::sync_channel(EVENT_QUEUE_CAPACITY);
        let stop = Arc::new(AtomicBool::new(false));
        let full_refresh = Arc::new(AtomicBool::new(false));
        let snapshot = Arc::new(RwLock::new(MediaSnapshot::default()));

        let worker_stop = Arc::clone(&stop);
        let worker_full_refresh = Arc::clone(&full_refresh);
        let worker_snapshot = Arc::clone(&snapshot);
        let worker_sender = sender.clone();
        let worker = thread::Builder::new()
            .name("widget-platform-media".to_string())
            .spawn(move || {
                run_worker(
                    receiver,
                    worker_sender,
                    worker_stop,
                    worker_full_refresh,
                    worker_snapshot,
                );
            })
            .map_err(|_| MediaBridgeError::ProviderUnavailable)?;

        Ok(Self {
            stop,
            full_refresh,
            sender,
            snapshot,
            worker: Some(worker),
        })
    }

    pub fn snapshot(&self) -> MediaSnapshot {
        self.snapshot
            .read()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_else(|_| MediaSnapshot {
                health: MediaHealth::Unavailable,
                error: Some(MediaErrorKind::ProviderUnavailable),
                ..MediaSnapshot::default()
            })
    }

    /// Starts one bounded, on-demand artwork read. The returned job can be
    /// cancelled or dropped; artwork stays separate from the text snapshot.
    pub fn request_artwork(&self, reference: &str) -> Result<ArtworkJob, MediaBridgeError> {
        if self.stop.load(Ordering::Acquire) {
            return Err(MediaBridgeError::Stopped);
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        let (response_tx, response_rx) = mpsc::channel();
        match self.sender.try_send(WorkerMessage::ReadArtwork {
            reference: reference.to_string(),
            cancelled: Arc::clone(&cancelled),
            response: response_tx,
        }) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => return Err(MediaBridgeError::Busy),
            Err(TrySendError::Disconnected(_)) => {
                return Err(MediaBridgeError::ProviderUnavailable)
            }
        }
        Ok(ArtworkJob {
            cancelled,
            response: response_rx,
        })
    }

    pub fn request_control(
        &self,
        session_id: &str,
        action: MediaControlAction,
        position_ms: Option<u64>,
    ) -> Result<MediaControlJob, MediaBridgeError> {
        if self.stop.load(Ordering::Acquire) {
            return Err(MediaBridgeError::Stopped);
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        let (response_tx, response_rx) = mpsc::channel();
        match self.sender.try_send(WorkerMessage::Control {
            session_id: session_id.to_string(),
            action,
            position_ms,
            cancelled: Arc::clone(&cancelled),
            response: response_tx,
        }) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => return Err(MediaBridgeError::Busy),
            Err(TrySendError::Disconnected(_)) => {
                return Err(MediaBridgeError::ProviderUnavailable)
            }
        }
        Ok(MediaControlJob {
            cancelled,
            response: response_rx,
        })
    }

    pub fn stop(mut self) {
        self.stop_and_join();
    }

    fn stop_and_join(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.full_refresh.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for MediaMonitor {
    fn drop(&mut self) {
        self.stop_and_join();
    }
}

fn run_worker(
    receiver: Receiver<WorkerMessage>,
    sender: SyncSender<WorkerMessage>,
    stop: Arc<AtomicBool>,
    full_refresh: Arc<AtomicBool>,
    shared_snapshot: Arc<RwLock<MediaSnapshot>>,
) {
    let _apartment = match ComApartment::initialize() {
        Ok(apartment) => apartment,
        Err(error) => {
            publish_unavailable(&shared_snapshot, error_kind_from_hresult(error));
            return;
        }
    };

    let operation = match GsmtcManager::RequestAsync() {
        Ok(operation) => operation,
        Err(error) => {
            publish_unavailable(&shared_snapshot, error_kind_from_hresult(error.code().0));
            return;
        }
    };
    let manager_result = wait_for_operation(
        || stop.load(Ordering::Acquire),
        || operation.Status().map_err(|error| error.code().0),
        || operation.Cancel().map_err(|error| error.code().0),
        || operation.GetResults().map_err(|error| error.code().0),
    );
    // Release this WinRT object while its COM apartment is still initialized.
    drop(operation);
    let manager = match manager_result {
        Ok(manager) => manager,
        Err(MediaBridgeError::Stopped) => {
            return;
        }
        Err(MediaBridgeError::OperationTimedOut) => {
            publish_unavailable(&shared_snapshot, MediaErrorKind::OperationTimedOut);
            return;
        }
        Err(_) => {
            publish_unavailable(&shared_snapshot, MediaErrorKind::ProviderUnavailable);
            return;
        }
    };

    run_manager(
        manager,
        receiver,
        sender,
        stop,
        full_refresh,
        shared_snapshot,
    );
}

fn run_manager(
    manager: GsmtcManager,
    receiver: Receiver<WorkerMessage>,
    sender: SyncSender<WorkerMessage>,
    stop: Arc<AtomicBool>,
    full_refresh: Arc<AtomicBool>,
    shared_snapshot: Arc<RwLock<MediaSnapshot>>,
) {
    let sessions_token = manager
        .SessionsChanged(&TypedEventHandler::new({
            let sender = sender.clone();
            let full_refresh = Arc::clone(&full_refresh);
            move |_, _| {
                enqueue_event(&sender, &full_refresh, NativeEvent::SessionsChanged);
                Ok(())
            }
        }))
        .ok();
    let current_token = manager
        .CurrentSessionChanged(&TypedEventHandler::new({
            let sender = sender.clone();
            let full_refresh = Arc::clone(&full_refresh);
            move |_, _| {
                enqueue_event(&sender, &full_refresh, NativeEvent::CurrentSessionChanged);
                Ok(())
            }
        }))
        .ok();
    let event_registration_partial = sessions_token.is_none() || current_token.is_none();
    let manager_tokens = ManagerTokens {
        sessions: sessions_token,
        current: current_token,
    };

    let mut entries = HashMap::<usize, SessionEntry>::new();
    let mut next_session_id = 1_u64;
    sync_sessions(
        &manager,
        &mut entries,
        &mut next_session_id,
        &sender,
        &full_refresh,
        &stop,
        &shared_snapshot,
        event_registration_partial,
    );

    while !stop.load(Ordering::Acquire) {
        if full_refresh.swap(false, Ordering::AcqRel) {
            sync_sessions(
                &manager,
                &mut entries,
                &mut next_session_id,
                &sender,
                &full_refresh,
                &stop,
                &shared_snapshot,
                event_registration_partial,
            );
        }

        match receiver.recv_timeout(EVENT_WAIT) {
            Ok(WorkerMessage::Event(NativeEvent::SessionsChanged)) => sync_sessions(
                &manager,
                &mut entries,
                &mut next_session_id,
                &sender,
                &full_refresh,
                &stop,
                &shared_snapshot,
                event_registration_partial,
            ),
            Ok(WorkerMessage::Event(NativeEvent::CurrentSessionChanged)) => publish_snapshot(
                &manager,
                &entries,
                event_registration_partial,
                false,
                &shared_snapshot,
            ),
            Ok(WorkerMessage::Event(NativeEvent::SessionChanged { identity, section })) => {
                if let Some(entry) = entries.get_mut(&identity) {
                    match section {
                        SessionSection::Metadata => entry.refresh_metadata(&stop, None),
                        SessionSection::Timeline => entry.refresh_timeline(),
                        SessionSection::Playback => entry.refresh_playback(),
                    }
                    publish_snapshot(
                        &manager,
                        &entries,
                        event_registration_partial,
                        false,
                        &shared_snapshot,
                    );
                }
            }
            Ok(WorkerMessage::ReadArtwork {
                reference,
                cancelled,
                response,
            }) => {
                let result = read_artwork(&entries, &reference, &stop, &cancelled);
                let _ = response.send(result);
            }
            Ok(WorkerMessage::Control {
                session_id,
                action,
                position_ms,
                cancelled,
                response,
            }) => {
                let result = if stop.load(Ordering::Acquire) || cancelled.load(Ordering::Acquire) {
                    Err(MediaBridgeError::Stopped)
                } else {
                    entries
                        .values_mut()
                        .find(|entry| entry.id == session_id)
                        .map(|entry| {
                            execute_session_control(entry, action, position_ms, &stop, &cancelled)
                        })
                        .unwrap_or(Err(MediaBridgeError::SessionNotFound))
                };
                let _ = response.send(result);
                publish_snapshot(
                    &manager,
                    &entries,
                    event_registration_partial,
                    false,
                    &shared_snapshot,
                );
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    for entry in entries.values() {
        entry.remove_handlers();
    }
    if let Some(token) = manager_tokens.sessions {
        let _ = manager.RemoveSessionsChanged(token);
    }
    if let Some(token) = manager_tokens.current {
        let _ = manager.RemoveCurrentSessionChanged(token);
    }
}

#[allow(clippy::too_many_arguments)]
fn sync_sessions(
    manager: &GsmtcManager,
    entries: &mut HashMap<usize, SessionEntry>,
    next_session_id: &mut u64,
    sender: &SyncSender<WorkerMessage>,
    full_refresh: &Arc<AtomicBool>,
    stop: &AtomicBool,
    shared_snapshot: &RwLock<MediaSnapshot>,
    manager_registration_partial: bool,
) {
    let sessions = match manager.GetSessions() {
        Ok(sessions) => sessions,
        Err(_) => {
            publish_snapshot(manager, entries, true, true, shared_snapshot);
            return;
        }
    };
    let count = match sessions.Size() {
        Ok(count) => count,
        Err(_) => {
            publish_snapshot(manager, entries, true, true, shared_snapshot);
            return;
        }
    };

    let mut observed_sessions = Vec::with_capacity(count as usize);
    let mut source_counts = HashMap::<String, usize>::new();
    let mut registration_partial = manager_registration_partial;
    for index in 0..count {
        let session = match sessions.GetAt(index) {
            Ok(session) => session,
            Err(_) => {
                registration_partial = true;
                continue;
            }
        };
        let identity = session_identity(&session);
        let source_id = session
            .SourceAppUserModelId()
            .ok()
            .map(|value| value.to_string().to_lowercase())
            .filter(|value| !value.is_empty());
        if let Some(source_id) = &source_id {
            *source_counts.entry(source_id.clone()).or_default() += 1;
        }
        observed_sessions.push((session, identity, source_id));
    }

    let mut present = HashSet::with_capacity(count as usize);
    for (session, identity, source_id) in observed_sessions {
        if entries.contains_key(&identity) {
            present.insert(identity);
            continue;
        }

        // GSMTC can hand back a new interface identity for a still-unique source.
        // Reuse that entry's public ID only when both sides are unambiguous.
        let reused_id = source_id
            .as_ref()
            .filter(|source_id| source_counts.get(*source_id) == Some(&1))
            .and_then(|source_id| {
                unique_session_identity_for_source(
                    entries.iter().map(|(identity, entry)| {
                        (*identity, entry.public.source_app_user_model_id.as_deref())
                    }),
                    source_id,
                )
            })
            .and_then(|old_identity| entries.remove(&old_identity))
            .map(|old_entry| {
                old_entry.remove_handlers();
                let id = old_entry.id.clone();
                drop(old_entry);
                id
            });

        let id = reused_id.unwrap_or_else(|| {
            let id = format!("media-session-{}", *next_session_id);
            *next_session_id = (*next_session_id).saturating_add(1);
            id
        });
        let tokens = register_session_events(&session, identity, sender, full_refresh);
        let entry = SessionEntry::new(id, session, tokens);
        if entry.failed_fields != 0 {
            registration_partial = true;
        }
        present.insert(identity);
        entries.insert(identity, entry);
    }

    let removed: Vec<usize> = entries
        .keys()
        .copied()
        .filter(|identity| !present.contains(identity))
        .collect();
    for identity in removed {
        if let Some(entry) = entries.remove(&identity) {
            entry.remove_handlers();
        }
    }

    if !stop.load(Ordering::Acquire) {
        for entry in entries.values_mut() {
            entry.refresh_all(stop);
        }
    }
    publish_snapshot(
        manager,
        entries,
        registration_partial,
        false,
        shared_snapshot,
    );
}

fn register_session_events(
    session: &GsmtcSession,
    identity: usize,
    sender: &SyncSender<WorkerMessage>,
    full_refresh: &Arc<AtomicBool>,
) -> SessionTokens {
    let playback = session
        .PlaybackInfoChanged(&TypedEventHandler::new({
            let sender = sender.clone();
            let full_refresh = Arc::clone(full_refresh);
            move |_, _| {
                enqueue_event(
                    &sender,
                    &full_refresh,
                    NativeEvent::SessionChanged {
                        identity,
                        section: SessionSection::Playback,
                    },
                );
                Ok(())
            }
        }))
        .ok();
    let metadata = session
        .MediaPropertiesChanged(&TypedEventHandler::new({
            let sender = sender.clone();
            let full_refresh = Arc::clone(full_refresh);
            move |_, _| {
                enqueue_event(
                    &sender,
                    &full_refresh,
                    NativeEvent::SessionChanged {
                        identity,
                        section: SessionSection::Metadata,
                    },
                );
                Ok(())
            }
        }))
        .ok();
    let timeline = session
        .TimelinePropertiesChanged(&TypedEventHandler::new({
            let sender = sender.clone();
            let full_refresh = Arc::clone(full_refresh);
            move |_, _| {
                enqueue_event(
                    &sender,
                    &full_refresh,
                    NativeEvent::SessionChanged {
                        identity,
                        section: SessionSection::Timeline,
                    },
                );
                Ok(())
            }
        }))
        .ok();

    SessionTokens {
        playback,
        metadata,
        timeline,
    }
}

fn enqueue_event(
    sender: &SyncSender<WorkerMessage>,
    full_refresh: &AtomicBool,
    event: NativeEvent,
) {
    match sender.try_send(WorkerMessage::Event(event)) {
        Ok(()) => {}
        Err(TrySendError::Full(_)) => full_refresh.store(true, Ordering::Release),
        Err(TrySendError::Disconnected(_)) => {}
    }
}

fn publish_snapshot(
    manager: &GsmtcManager,
    entries: &HashMap<usize, SessionEntry>,
    registration_partial: bool,
    force_partial: bool,
    shared_snapshot: &RwLock<MediaSnapshot>,
) {
    let current_session_id = manager.GetCurrentSession().ok().and_then(|session| {
        let identity = session_identity(&session);
        entries
            .get(&identity)
            .map(|entry| entry.id.clone())
            .or_else(|| {
                let source_id = session.SourceAppUserModelId().ok()?.to_string();
                unique_session_id_for_source(
                    entries.values().map(|entry| &entry.public),
                    &source_id,
                )
            })
    });

    let mut sessions: Vec<MediaSession> =
        entries.values().map(|entry| entry.public.clone()).collect();
    sessions.sort_by(|left, right| left.session_id.cmp(&right.session_id));

    let has_partial_session = sessions
        .iter()
        .any(|session| session.quality != MediaHealth::Available);
    let health = if force_partial || registration_partial || has_partial_session {
        MediaHealth::Partial
    } else {
        MediaHealth::Available
    };
    let snapshot = MediaSnapshot {
        observed_at_ms: unix_time_ms(),
        health,
        error: if force_partial {
            Some(MediaErrorKind::ProviderUnavailable)
        } else {
            None
        },
        current_session_id,
        sessions,
    };

    if let Ok(mut guard) = shared_snapshot.write() {
        *guard = snapshot;
    }
}

fn publish_unavailable(shared_snapshot: &RwLock<MediaSnapshot>, error: MediaErrorKind) {
    let snapshot = MediaSnapshot {
        observed_at_ms: unix_time_ms(),
        health: MediaHealth::Unavailable,
        error: Some(error),
        current_session_id: None,
        sessions: Vec::new(),
    };
    if let Ok(mut guard) = shared_snapshot.write() {
        *guard = snapshot;
    }
}

fn session_identity(session: &GsmtcSession) -> usize {
    session
        .cast::<IUnknown>()
        .map(|identity| identity.as_raw() as usize)
        .unwrap_or_else(|_| session.as_raw() as usize)
}

pub(super) fn unique_session_identity_for_source<'a>(
    sessions: impl Iterator<Item = (usize, Option<&'a str>)>,
    source_id: &str,
) -> Option<usize> {
    let source_id = source_id.to_lowercase();
    let mut matches = sessions
        .filter(|(_, candidate)| candidate.is_some_and(|id| id.to_lowercase() == source_id));
    let identity = matches.next()?.0;
    if matches.next().is_some() {
        None
    } else {
        Some(identity)
    }
}

pub(super) fn unique_session_id_for_source<'a>(
    sessions: impl Iterator<Item = &'a MediaSession>,
    source_id: &str,
) -> Option<String> {
    let source_id = source_id.to_lowercase();
    let mut matches = sessions.filter(|session| {
        session
            .source_app_user_model_id
            .as_deref()
            .is_some_and(|id| id.to_lowercase() == source_id)
    });
    let session_id = matches.next()?.session_id.clone();
    if matches.next().is_some() {
        None
    } else {
        Some(session_id)
    }
}

fn read_metadata(result: WinResult<windows::core::HSTRING>, failed: &mut bool) -> Option<String> {
    match result {
        Ok(value) => normalize_metadata(&value.to_string()),
        Err(_) => {
            *failed = true;
            None
        }
    }
}

fn execute_session_control(
    entry: &mut SessionEntry,
    action: MediaControlAction,
    position_ms: Option<u64>,
    stop: &AtomicBool,
    cancelled: &AtomicBool,
) -> Result<bool, MediaBridgeError> {
    if stop.load(Ordering::Acquire) || cancelled.load(Ordering::Acquire) {
        return Err(MediaBridgeError::Stopped);
    }

    entry.refresh_timeline();
    entry.refresh_playback();
    let result = {
        let session = &entry.session;
        dispatch_media_control(&entry.public, action, position_ms, |request| {
            invoke_session_control(session, request, stop, cancelled)
        })
    };
    if result == Ok(true) {
        entry.refresh_timeline();
        entry.refresh_playback();
    }
    result
}

fn invoke_session_control(
    session: &GsmtcSession,
    request: ValidatedMediaControl,
    stop: &AtomicBool,
    cancelled: &AtomicBool,
) -> Result<bool, MediaBridgeError> {
    if stop.load(Ordering::Acquire) || cancelled.load(Ordering::Acquire) {
        return Err(MediaBridgeError::Stopped);
    }
    let operation = match request.action {
        MediaControlAction::Play => session.TryPlayAsync(),
        MediaControlAction::Pause => session.TryPauseAsync(),
        MediaControlAction::Previous => session.TrySkipPreviousAsync(),
        MediaControlAction::Next => session.TrySkipNextAsync(),
        MediaControlAction::Seek => session.TryChangePlaybackPositionAsync(
            request
                .position_ticks
                .ok_or(MediaBridgeError::InvalidControlRequest)?,
        ),
    }
    .map_err(|_| MediaBridgeError::ControlFailed)?;

    wait_for_operation(
        || stop.load(Ordering::Acquire) || cancelled.load(Ordering::Acquire),
        || operation.Status().map_err(|error| error.code().0),
        || operation.Cancel().map_err(|error| error.code().0),
        || operation.GetResults().map_err(|error| error.code().0),
    )
    .map_err(|error| match error {
        MediaBridgeError::Stopped => MediaBridgeError::Stopped,
        MediaBridgeError::OperationTimedOut => MediaBridgeError::OperationTimedOut,
        _ => MediaBridgeError::ControlFailed,
    })
}

fn playback_state(status: GsmtcPlaybackStatus) -> MediaPlaybackState {
    match status {
        GsmtcPlaybackStatus::Closed => MediaPlaybackState::Closed,
        GsmtcPlaybackStatus::Opened => MediaPlaybackState::Opened,
        GsmtcPlaybackStatus::Changing => MediaPlaybackState::Changing,
        GsmtcPlaybackStatus::Stopped => MediaPlaybackState::Stopped,
        GsmtcPlaybackStatus::Playing => MediaPlaybackState::Playing,
        GsmtcPlaybackStatus::Paused => MediaPlaybackState::Paused,
        _ => MediaPlaybackState::Changing,
    }
}

fn read_artwork(
    entries: &HashMap<usize, SessionEntry>,
    artwork_id: &str,
    stop: &AtomicBool,
    cancelled: &AtomicBool,
) -> Result<ArtworkData, MediaBridgeError> {
    if stop.load(Ordering::Acquire) || cancelled.load(Ordering::Acquire) {
        return Err(MediaBridgeError::Stopped);
    }
    let entry = entries
        .values()
        .find(|entry| entry.public.artwork_ref.as_deref() == Some(artwork_id))
        .ok_or(MediaBridgeError::ArtworkUnavailable)?;
    let reference = entry
        .artwork
        .as_ref()
        .ok_or(MediaBridgeError::ArtworkUnavailable)?;
    let stream_operation = reference
        .OpenReadAsync()
        .map_err(|_| MediaBridgeError::ArtworkUnavailable)?;
    let stream = wait_for_operation(
        || stop.load(Ordering::Acquire) || cancelled.load(Ordering::Acquire),
        || stream_operation.Status().map_err(|error| error.code().0),
        || stream_operation.Cancel().map_err(|error| error.code().0),
        || {
            stream_operation
                .GetResults()
                .map_err(|error| error.code().0)
        },
    )
    .map_err(|error| match error {
        MediaBridgeError::Stopped => MediaBridgeError::Stopped,
        MediaBridgeError::OperationTimedOut => MediaBridgeError::OperationTimedOut,
        _ => MediaBridgeError::ArtworkUnavailable,
    })?;

    let size = stream
        .Size()
        .map_err(|_| MediaBridgeError::ArtworkUnavailable)?;
    let length = artwork_length(size).map_err(|error| match error {
        ArtworkError::Empty => MediaBridgeError::ArtworkUnavailable,
        ArtworkError::TooLarge => MediaBridgeError::ArtworkTooLarge,
    })?;
    let buffer = Buffer::Create(length as u32).map_err(|_| MediaBridgeError::ArtworkUnavailable)?;
    let read_operation = stream
        .ReadAsync(&buffer, length as u32, InputStreamOptions::None)
        .map_err(|_| MediaBridgeError::ArtworkUnavailable)?;
    let read_buffer = wait_for_operation(
        || stop.load(Ordering::Acquire) || cancelled.load(Ordering::Acquire),
        || read_operation.Status().map_err(|error| error.code().0),
        || read_operation.Cancel().map_err(|error| error.code().0),
        || read_operation.GetResults().map_err(|error| error.code().0),
    )
    .map_err(|error| match error {
        MediaBridgeError::Stopped => MediaBridgeError::Stopped,
        MediaBridgeError::OperationTimedOut => MediaBridgeError::OperationTimedOut,
        _ => MediaBridgeError::ArtworkUnavailable,
    })?;
    let actual_length = read_buffer
        .Length()
        .map_err(|_| MediaBridgeError::ArtworkUnavailable)? as usize;
    if actual_length == 0 || actual_length > length {
        return Err(MediaBridgeError::ArtworkUnavailable);
    }
    let reader =
        DataReader::FromBuffer(&read_buffer).map_err(|_| MediaBridgeError::ArtworkUnavailable)?;
    let mut bytes = vec![0_u8; actual_length];
    reader
        .ReadBytes(&mut bytes)
        .map_err(|_| MediaBridgeError::ArtworkUnavailable)?;
    let content_type = stream
        .ContentType()
        .map(|value| value.to_string())
        .unwrap_or_else(|_| "application/octet-stream".to_string());
    Ok(ArtworkData {
        content_type,
        bytes,
    })
}

fn wait_for_operation<T>(
    cancelled: impl Fn() -> bool,
    mut status: impl FnMut() -> Result<AsyncStatus, i32>,
    mut cancel: impl FnMut() -> Result<(), i32>,
    mut get_results: impl FnMut() -> Result<T, i32>,
) -> Result<T, MediaBridgeError> {
    let deadline = Instant::now() + OPERATION_TIMEOUT;
    loop {
        if cancelled() {
            let _ = cancel();
            return Err(MediaBridgeError::Stopped);
        }
        match status().map_err(|_| MediaBridgeError::ProviderUnavailable)? {
            AsyncStatus::Completed => {
                return get_results().map_err(|_| MediaBridgeError::ProviderUnavailable);
            }
            AsyncStatus::Canceled => return Err(MediaBridgeError::Stopped),
            AsyncStatus::Error => return Err(MediaBridgeError::ProviderUnavailable),
            AsyncStatus::Started => {}
            _ => return Err(MediaBridgeError::ProviderUnavailable),
        }
        if Instant::now() >= deadline {
            let _ = cancel();
            return Err(MediaBridgeError::OperationTimedOut);
        }
        thread::sleep(Duration::from_millis(20));
    }
}

fn unix_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or_default()
}

use super::model::{
    WeatherError, WeatherLocation, WeatherQuality, WeatherReadState, WeatherSnapshot,
};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub(super) const WEATHER_REFRESH_INTERVAL: Duration = Duration::from_secs(30 * 60);
const INITIAL_FAILURE_BACKOFF: Duration = Duration::from_secs(60);
const MAX_FAILURE_BACKOFF: Duration = Duration::from_secs(30 * 60);
const CACHE_SCHEMA_VERSION: u8 = 1;
const MAX_CACHE_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WeatherCacheEntry {
    schema_version: u8,
    fetched_at_ms: u64,
    snapshot: WeatherSnapshot,
}

#[derive(Default)]
struct RuntimeInner {
    active: Option<ActiveRead>,
    cache: Option<WeatherCacheEntry>,
    schedule_location: Option<WeatherLocation>,
    consecutive_failures: u32,
    next_attempt_at: Option<Instant>,
    last_failure_reason: Option<&'static str>,
}

struct ActiveRead {
    location: WeatherLocation,
    cancellation: Arc<AtomicBool>,
}

pub struct WeatherRuntime {
    inner: Arc<Mutex<RuntimeInner>>,
    cache_path: Option<PathBuf>,
    client: reqwest::Client,
}

pub(super) enum BeginWeatherRead {
    Ready(WeatherReadState),
    Fetch(WeatherReadTicket),
}

impl WeatherRuntime {
    pub fn new(cache_path: PathBuf) -> Self {
        let cache = load_cache(&cache_path);
        Self {
            inner: Arc::new(Mutex::new(RuntimeInner {
                cache,
                ..RuntimeInner::default()
            })),
            cache_path: Some(cache_path),
            client: weather_client(),
        }
    }

    pub fn memory_only() -> Self {
        Self {
            inner: Arc::new(Mutex::new(RuntimeInner::default())),
            cache_path: None,
            client: weather_client(),
        }
    }

    pub(super) fn client(&self) -> reqwest::Client {
        self.client.clone()
    }

    pub(super) fn begin(
        &self,
        location: WeatherLocation,
        now_ms: u64,
        now: Instant,
    ) -> Result<BeginWeatherRead, WeatherError> {
        location.validate()?;
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| WeatherError::new("transport", "天气服务状态不可用。", true))?;
        if let Some(active) = inner.active.as_ref() {
            if active.location == location {
                return Err(WeatherError::new(
                    "refreshInProgress",
                    "天气正在更新。",
                    true,
                ));
            }
            active.cancellation.store(true, Ordering::SeqCst);
            inner.active = None;
        }

        if inner.schedule_location.as_ref() != Some(&location) {
            inner.schedule_location = Some(location.clone());
            inner.consecutive_failures = 0;
            inner.next_attempt_at = None;
            inner.last_failure_reason = None;
        }

        if matching_cache(&inner, &location).is_some_and(|cache| cache.fetched_at_ms > now_ms) {
            inner.cache = None;
            inner.consecutive_failures = 0;
            inner.next_attempt_at = None;
            inner.last_failure_reason = None;
        }

        if let Some(cache) = matching_cache(&inner, &location) {
            let age_ms = now_ms - cache.fetched_at_ms;
            let refresh_ms = WEATHER_REFRESH_INTERVAL.as_millis() as u64;
            if age_ms < refresh_ms {
                return Ok(BeginWeatherRead::Ready(read_state(
                    WeatherQuality::Fresh,
                    Some(cache.snapshot.clone()),
                    None,
                    refresh_ms - age_ms,
                    Some(cache.fetched_at_ms),
                )));
            }
        }

        if let Some(delay) = inner
            .next_attempt_at
            .map(|next| next.saturating_duration_since(now))
            .filter(|delay| !delay.is_zero())
        {
            let snapshot = matching_cache(&inner, &location).map(|cache| cache.snapshot.clone());
            let quality = if snapshot.is_some() {
                WeatherQuality::Stale
            } else {
                WeatherQuality::Unavailable
            };
            return Ok(BeginWeatherRead::Ready(read_state(
                quality,
                snapshot,
                inner.last_failure_reason.or(Some("network")),
                duration_millis(delay),
                Some(now_ms),
            )));
        }

        let cancellation = Arc::new(AtomicBool::new(false));
        inner.active = Some(ActiveRead {
            location: location.clone(),
            cancellation: cancellation.clone(),
        });
        Ok(BeginWeatherRead::Fetch(WeatherReadTicket {
            inner: self.inner.clone(),
            cache_path: self.cache_path.clone(),
            location,
            cancellation,
            completed: false,
        }))
    }

    pub(super) fn cancel_active(&self, location: &WeatherLocation) -> bool {
        let Ok(mut inner) = self.inner.lock() else {
            return false;
        };
        if !inner
            .active
            .as_ref()
            .is_some_and(|active| &active.location == location)
        {
            return false;
        }
        let Some(active) = inner.active.take() else {
            return false;
        };
        active.cancellation.store(true, Ordering::SeqCst);
        true
    }

    fn cancel_any(&self) -> bool {
        let Ok(mut inner) = self.inner.lock() else {
            return false;
        };
        let Some(active) = inner.active.take() else {
            return false;
        };
        active.cancellation.store(true, Ordering::SeqCst);
        true
    }
}

impl Drop for WeatherRuntime {
    fn drop(&mut self) {
        self.cancel_any();
    }
}

pub(super) struct WeatherReadTicket {
    inner: Arc<Mutex<RuntimeInner>>,
    cache_path: Option<PathBuf>,
    location: WeatherLocation,
    cancellation: Arc<AtomicBool>,
    completed: bool,
}

impl WeatherReadTicket {
    pub(super) fn cancellation(&self) -> Arc<AtomicBool> {
        self.cancellation.clone()
    }

    pub(super) fn succeed(
        mut self,
        snapshot: WeatherSnapshot,
        now_ms: u64,
        now: Instant,
    ) -> WeatherReadState {
        let cache = WeatherCacheEntry {
            schema_version: CACHE_SCHEMA_VERSION,
            fetched_at_ms: now_ms,
            snapshot: snapshot.clone(),
        };
        let mut accepted = false;
        if let Ok(mut inner) = self.inner.lock() {
            if is_current(&inner, &self.cancellation) {
                inner.active = None;
                inner.cache = Some(cache.clone());
                inner.schedule_location = Some(self.location.clone());
                inner.consecutive_failures = 0;
                inner.next_attempt_at = Some(now + WEATHER_REFRESH_INTERVAL);
                inner.last_failure_reason = None;
                accepted = true;
            }
        }
        if accepted {
            if let Some(cache_path) = &self.cache_path {
                let _ = persist_cache(cache_path, &cache);
            }
        }
        let state = if accepted {
            read_state(
                WeatherQuality::Fresh,
                Some(snapshot),
                None,
                WEATHER_REFRESH_INTERVAL.as_millis() as u64,
                Some(now_ms),
            )
        } else {
            finish_cancellation(&self.inner, &self.cancellation, &self.location, now_ms)
        };
        self.completed = true;
        state
    }

    pub(super) fn fail(
        mut self,
        reason: &'static str,
        now_ms: u64,
        now: Instant,
    ) -> WeatherReadState {
        let state = finish_failure(
            &self.inner,
            &self.cancellation,
            &self.location,
            reason,
            now_ms,
            now,
        );
        self.completed = true;
        state
    }

    pub(super) fn cancel(mut self, now_ms: u64) -> WeatherReadState {
        let state = finish_cancellation(&self.inner, &self.cancellation, &self.location, now_ms);
        self.completed = true;
        state
    }
}

impl Drop for WeatherReadTicket {
    fn drop(&mut self) {
        if self.completed {
            return;
        }
        self.cancellation.store(true, Ordering::SeqCst);
        let _ = finish_cancellation(
            &self.inner,
            &self.cancellation,
            &self.location,
            current_time_millis(),
        );
        self.completed = true;
    }
}

fn finish_cancellation(
    inner: &Arc<Mutex<RuntimeInner>>,
    cancellation: &Arc<AtomicBool>,
    location: &WeatherLocation,
    now_ms: u64,
) -> WeatherReadState {
    let Ok(mut inner) = inner.lock() else {
        return read_state(
            WeatherQuality::Unavailable,
            None,
            Some("cancelled"),
            0,
            Some(now_ms),
        );
    };
    if is_current(&inner, cancellation) {
        inner.active = None;
    }
    let snapshot = matching_cache(&inner, location).map(|cache| cache.snapshot.clone());
    read_state(
        if snapshot.is_some() {
            WeatherQuality::Stale
        } else {
            WeatherQuality::Unavailable
        },
        snapshot,
        Some("cancelled"),
        0,
        Some(now_ms),
    )
}

fn finish_failure(
    inner: &Arc<Mutex<RuntimeInner>>,
    cancellation: &Arc<AtomicBool>,
    location: &WeatherLocation,
    reason: &'static str,
    now_ms: u64,
    now: Instant,
) -> WeatherReadState {
    let Ok(mut inner) = inner.lock() else {
        return read_state(
            WeatherQuality::Unavailable,
            None,
            Some("transport"),
            INITIAL_FAILURE_BACKOFF.as_millis() as u64,
            Some(now_ms),
        );
    };
    if is_current(&inner, cancellation) {
        inner.active = None;
        inner.schedule_location = Some(location.clone());
        inner.consecutive_failures = inner.consecutive_failures.saturating_add(1);
        let shift = inner.consecutive_failures.saturating_sub(1).min(20);
        let multiplier = 1u32.checked_shl(shift).unwrap_or(u32::MAX);
        let delay = INITIAL_FAILURE_BACKOFF
            .saturating_mul(multiplier)
            .min(MAX_FAILURE_BACKOFF);
        inner.next_attempt_at = Some(now + delay);
        inner.last_failure_reason = Some(reason);
    }
    let delay = inner
        .next_attempt_at
        .map(|next| next.saturating_duration_since(now))
        .unwrap_or(INITIAL_FAILURE_BACKOFF);
    let snapshot = matching_cache(&inner, location).map(|cache| cache.snapshot.clone());
    read_state(
        if snapshot.is_some() {
            WeatherQuality::Stale
        } else {
            WeatherQuality::Unavailable
        },
        snapshot,
        Some(reason),
        duration_millis(delay),
        Some(now_ms),
    )
}

fn matching_cache<'a>(
    inner: &'a RuntimeInner,
    location: &WeatherLocation,
) -> Option<&'a WeatherCacheEntry> {
    inner
        .cache
        .as_ref()
        .filter(|cache| &cache.snapshot.location == location)
}

fn is_current(inner: &RuntimeInner, cancellation: &Arc<AtomicBool>) -> bool {
    inner
        .active
        .as_ref()
        .is_some_and(|active| Arc::ptr_eq(&active.cancellation, cancellation))
}

fn read_state(
    quality: WeatherQuality,
    snapshot: Option<WeatherSnapshot>,
    failure_reason: Option<&'static str>,
    retry_after_ms: u64,
    last_attempt_at_ms: Option<u64>,
) -> WeatherReadState {
    WeatherReadState {
        schema_version: 1,
        quality,
        snapshot,
        failure_reason,
        retry_after_ms,
        last_attempt_at_ms,
    }
}

fn duration_millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

fn current_time_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn weather_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("Widget Platform/0.1 weather")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

fn load_cache(path: &Path) -> Option<WeatherCacheEntry> {
    if !cache_file_is_bounded(path) {
        return None;
    }
    let file = File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(MAX_CACHE_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_CACHE_BYTES {
        return None;
    }
    let cache = serde_json::from_slice::<WeatherCacheEntry>(&bytes).ok()?;
    (cache.schema_version == CACHE_SCHEMA_VERSION
        && cache.fetched_at_ms > 0
        && valid_cached_snapshot(&cache.snapshot))
    .then_some(cache)
}

pub(super) fn cache_file_is_bounded(path: &Path) -> bool {
    fs::metadata(path)
        .ok()
        .is_some_and(|metadata| metadata.is_file() && metadata.len() <= MAX_CACHE_BYTES)
}

fn valid_cached_snapshot(snapshot: &WeatherSnapshot) -> bool {
    snapshot.schema_version == 1
        && snapshot.source == "Open-Meteo"
        && snapshot.location.validate().is_ok()
        && snapshot.provider_timezone == snapshot.location.timezone
        && snapshot.observed_at_ms > 0
        && snapshot.current.temperature.is_finite()
        && snapshot.daily.high_temperature.is_finite()
        && snapshot.daily.low_temperature.is_finite()
        && snapshot.daily.low_temperature <= snapshot.daily.high_temperature
        && !snapshot.hourly.is_empty()
        && snapshot.hourly.len() <= 48
        && snapshot
            .hourly
            .iter()
            .all(|point| point.at_ms > 0 && point.temperature.is_finite())
        && snapshot
            .hourly
            .windows(2)
            .all(|pair| pair[0].at_ms < pair[1].at_ms)
}

fn persist_cache(path: &Path, cache: &WeatherCacheEntry) -> Result<(), std::io::Error> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "cache path has no parent")
    })?;
    fs::create_dir_all(parent)?;
    let bytes = serde_json::to_vec(cache)?;
    let temporary = parent.join(format!(
        ".weather-cache-{}-{}.tmp",
        std::process::id(),
        current_time_millis()
    ));
    fs::write(&temporary, bytes)?;
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    match fs::rename(&temporary, path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            Err(error)
        }
    }
}

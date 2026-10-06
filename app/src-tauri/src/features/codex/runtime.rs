use super::model::CodexQuotaError;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub(super) const DEFAULT_REFRESH_INTERVAL: Duration = Duration::from_secs(3 * 60);
const MAX_FAILURE_BACKOFF: Duration = Duration::from_secs(60 * 60);

#[derive(Default)]
pub(super) struct CodexRefreshSchedule {
    consecutive_failures: u32,
    next_refresh_at: Option<Instant>,
}

impl CodexRefreshSchedule {
    pub(super) fn delay_until_next(&self, now: Instant) -> Option<Duration> {
        self.next_refresh_at
            .map(|next| next.saturating_duration_since(now))
            .filter(|delay| !delay.is_zero())
    }

    pub(super) fn record_success(&mut self, now: Instant) {
        self.consecutive_failures = 0;
        self.next_refresh_at = Some(now + DEFAULT_REFRESH_INTERVAL);
    }

    pub(super) fn record_failure(&mut self, now: Instant) {
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        let shift = self.consecutive_failures.saturating_sub(1).min(20);
        let multiplier = 1u32.checked_shl(shift).unwrap_or(u32::MAX);
        let delay = DEFAULT_REFRESH_INTERVAL
            .saturating_mul(multiplier)
            .min(MAX_FAILURE_BACKOFF);
        self.next_refresh_at = Some(now + delay);
    }
}

#[derive(Default)]
struct RuntimeInner {
    active_cancellation: Option<Arc<AtomicBool>>,
    schedule: CodexRefreshSchedule,
}

pub struct CodexRuntime {
    inner: Arc<Mutex<RuntimeInner>>,
}

impl CodexRuntime {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(RuntimeInner::default())),
        }
    }

    pub(super) fn begin(&self) -> Result<CodexReadTicket, CodexQuotaError> {
        let now = Instant::now();
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| CodexQuotaError::failure("transportError"))?;
        if inner.active_cancellation.is_some() {
            return Err(CodexQuotaError::failure("refreshInProgress"));
        }
        if let Some(delay) = inner.schedule.delay_until_next(now) {
            return Err(CodexQuotaError::retry_after(
                "refreshNotDue",
                u64::try_from(delay.as_millis()).unwrap_or(u64::MAX),
            ));
        }

        let cancellation = Arc::new(AtomicBool::new(false));
        inner.active_cancellation = Some(cancellation.clone());
        Ok(CodexReadTicket {
            inner: self.inner.clone(),
            cancellation,
            completed: false,
        })
    }

    pub(super) fn cancel_active(&self) -> bool {
        let Ok(inner) = self.inner.lock() else {
            return false;
        };
        let Some(cancellation) = &inner.active_cancellation else {
            return false;
        };
        cancellation.store(true, Ordering::SeqCst);
        true
    }
}

impl Default for CodexRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for CodexRuntime {
    fn drop(&mut self) {
        if let Ok(inner) = self.inner.lock() {
            if let Some(cancellation) = &inner.active_cancellation {
                cancellation.store(true, Ordering::SeqCst);
            }
        }
    }
}

pub(super) struct CodexCancellationGuard {
    cancellation: Arc<AtomicBool>,
    armed: bool,
}

impl CodexCancellationGuard {
    pub(super) fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for CodexCancellationGuard {
    fn drop(&mut self) {
        if self.armed {
            self.cancellation.store(true, Ordering::SeqCst);
        }
    }
}

pub(super) struct CodexReadTicket {
    inner: Arc<Mutex<RuntimeInner>>,
    cancellation: Arc<AtomicBool>,
    completed: bool,
}

impl CodexReadTicket {
    pub(super) fn cancellation(&self) -> Arc<AtomicBool> {
        self.cancellation.clone()
    }

    pub(super) fn cancellation_guard(&self) -> CodexCancellationGuard {
        CodexCancellationGuard {
            cancellation: self.cancellation.clone(),
            armed: true,
        }
    }

    pub(super) fn complete(mut self, succeeded: bool) {
        self.finish(succeeded);
        self.completed = true;
    }

    fn finish(&mut self, succeeded: bool) {
        let now = Instant::now();
        if let Ok(mut inner) = self.inner.lock() {
            let is_current = inner
                .active_cancellation
                .as_ref()
                .is_some_and(|active| Arc::ptr_eq(active, &self.cancellation));
            if is_current {
                inner.active_cancellation = None;
                if succeeded {
                    inner.schedule.record_success(now);
                } else {
                    inner.schedule.record_failure(now);
                }
            }
        }
    }
}

impl Drop for CodexReadTicket {
    fn drop(&mut self) {
        if self.completed {
            return;
        }
        self.cancellation.store(true, Ordering::SeqCst);
        self.finish(false);
        self.completed = true;
    }
}

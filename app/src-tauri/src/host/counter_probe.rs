use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::Duration;

pub const COUNTER_CHANGED_EVENT: &str = "counter-probe://changed";

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CounterSnapshot {
    pub schema_version: u16,
    pub revision: u64,
    pub instance_id: String,
    pub value: u64,
    pub enabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl IpcError {
    fn new(code: &str, message: &str, retryable: bool) -> Self {
        Self {
            code: code.to_owned(),
            message: message.to_owned(),
            retryable,
        }
    }
}

type IpcResult<T> = Result<T, IpcError>;
type ChangedHandler = Arc<dyn Fn(CounterSnapshot) -> Result<(), ()> + Send + Sync>;

struct Worker {
    cancellation: Arc<Cancellation>,
    join: JoinHandle<()>,
}

struct Cancellation {
    cancelled: Mutex<bool>,
    wake: Condvar,
}

impl Cancellation {
    fn new() -> Self {
        Self {
            cancelled: Mutex::new(false),
            wake: Condvar::new(),
        }
    }

    fn wait(&self, duration: Duration) -> bool {
        let Ok(cancelled) = self.cancelled.lock() else {
            return true;
        };
        if *cancelled {
            return true;
        }
        let Ok((cancelled, _)) = self
            .wake
            .wait_timeout_while(cancelled, duration, |value| !*value)
        else {
            return true;
        };
        *cancelled
    }

    fn cancel(&self) {
        let mut cancelled = self
            .cancelled
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *cancelled = true;
        self.wake.notify_all();
    }
}

pub struct CounterProbe {
    snapshot: Arc<Mutex<CounterSnapshot>>,
    worker: Mutex<Option<Worker>>,
    last_error: Arc<Mutex<Option<IpcError>>>,
    next_instance: AtomicU64,
    active_workers: Arc<AtomicUsize>,
}

impl Default for CounterProbe {
    fn default() -> Self {
        Self::new()
    }
}

impl CounterProbe {
    pub fn new() -> Self {
        Self {
            snapshot: Arc::new(Mutex::new(CounterSnapshot {
                schema_version: 1,
                revision: 0,
                instance_id: String::new(),
                value: 0,
                enabled: false,
            })),
            worker: Mutex::new(None),
            last_error: Arc::new(Mutex::new(None)),
            next_instance: AtomicU64::new(1),
            active_workers: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub fn snapshot(&self) -> IpcResult<CounterSnapshot> {
        if let Some(error) = self.lock_last_error()?.clone() {
            return Err(error);
        }
        Ok(self.lock_snapshot()?.clone())
    }

    pub fn enable(&self, on_changed: ChangedHandler) -> IpcResult<CounterSnapshot> {
        let mut worker_slot = self.lock_worker()?;
        if worker_slot.is_some() {
            return self.snapshot();
        }

        *self.lock_last_error()? = None;
        let instance_number = self.next_instance.fetch_add(1, Ordering::Relaxed);
        let instance_id = format!("{}-{instance_number}", std::process::id());
        {
            let mut snapshot = self.lock_snapshot()?;
            snapshot.schema_version = 1;
            snapshot.revision = 1;
            snapshot.instance_id = instance_id.clone();
            snapshot.value = 0;
            snapshot.enabled = true;
        }

        let cancellation = Arc::new(Cancellation::new());
        let thread_cancellation = Arc::clone(&cancellation);
        let thread_snapshot = Arc::clone(&self.snapshot);
        let active_workers = Arc::clone(&self.active_workers);
        let last_error = Arc::clone(&self.last_error);
        active_workers.fetch_add(1, Ordering::AcqRel);

        let join = match thread::Builder::new()
            .name("widget-counter-probe".to_owned())
            .spawn(move || {
                let _active = ActiveWorker::new(active_workers);
                run_worker(
                    thread_cancellation,
                    thread_snapshot,
                    instance_id,
                    last_error,
                    on_changed,
                );
            }) {
            Ok(join) => join,
            Err(_) => {
                self.active_workers.fetch_sub(1, Ordering::AcqRel);
                let mut snapshot = self.lock_snapshot()?;
                snapshot.enabled = false;
                snapshot.revision = snapshot.revision.saturating_add(1);
                return Err(IpcError::new(
                    "COUNTER_WORKER_START_FAILED",
                    "无法启动计数器后台任务。",
                    true,
                ));
            }
        };

        *worker_slot = Some(Worker { cancellation, join });
        self.snapshot()
    }

    pub fn disable(&self, on_changed: ChangedHandler) -> IpcResult<CounterSnapshot> {
        let mut worker_slot = self.lock_worker()?;
        let worker = worker_slot.take();
        let join_failed = if let Some(worker) = worker {
            worker.cancellation.cancel();
            worker.join.join().is_err()
        } else {
            false
        };

        let changed = {
            let mut snapshot = self.lock_snapshot()?;
            if snapshot.enabled {
                snapshot.enabled = false;
                snapshot.revision = snapshot.revision.saturating_add(1);
                Some(snapshot.clone())
            } else {
                None
            }
        };

        if let Some(snapshot) = changed {
            if on_changed(snapshot.clone()).is_err() {
                *self.lock_last_error()? = Some(IpcError::new(
                    "COUNTER_EVENT_FAILED",
                    "计数器状态已更新，但变更通知未能送达。",
                    true,
                ));
            }
        }

        if join_failed {
            return Err(IpcError::new(
                "COUNTER_WORKER_STOP_FAILED",
                "计数器后台任务未能正常结束。",
                true,
            ));
        }

        self.snapshot()
    }

    fn lock_snapshot(&self) -> IpcResult<MutexGuard<'_, CounterSnapshot>> {
        self.snapshot
            .lock()
            .map_err(|_| IpcError::new("COUNTER_STATE_UNAVAILABLE", "计数器状态暂时不可用。", true))
    }

    fn lock_worker(&self) -> IpcResult<MutexGuard<'_, Option<Worker>>> {
        self.worker.lock().map_err(|_| {
            IpcError::new(
                "COUNTER_LIFECYCLE_UNAVAILABLE",
                "计数器生命周期暂时不可用。",
                true,
            )
        })
    }

    fn lock_last_error(&self) -> IpcResult<MutexGuard<'_, Option<IpcError>>> {
        self.last_error.lock().map_err(|_| {
            IpcError::new(
                "COUNTER_STATE_UNAVAILABLE",
                "计数器错误状态暂时不可用。",
                true,
            )
        })
    }

    #[cfg(test)]
    fn active_worker_count(&self) -> usize {
        self.active_workers.load(Ordering::Acquire)
    }
}

impl Drop for CounterProbe {
    fn drop(&mut self) {
        let on_changed: ChangedHandler = Arc::new(|_| Ok(()));
        let _ = self.disable(on_changed);
    }
}

struct ActiveWorker(Arc<AtomicUsize>);

impl ActiveWorker {
    fn new(active_workers: Arc<AtomicUsize>) -> Self {
        Self(active_workers)
    }
}

impl Drop for ActiveWorker {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

fn run_worker(
    cancellation: Arc<Cancellation>,
    snapshot: Arc<Mutex<CounterSnapshot>>,
    instance_id: String,
    last_error: Arc<Mutex<Option<IpcError>>>,
    on_changed: ChangedHandler,
) {
    loop {
        if cancellation.wait(Duration::from_millis(100)) {
            return;
        }
        let next = match snapshot.lock() {
            Ok(mut current) if current.enabled && current.instance_id == instance_id => {
                current.revision = current.revision.saturating_add(1);
                current.value = current.value.saturating_add(1);
                Some(current.clone())
            }
            Ok(_) => None,
            Err(_) => {
                set_worker_error(
                    &last_error,
                    IpcError::new("COUNTER_STATE_UNAVAILABLE", "计数器状态暂时不可用。", true),
                );
                return;
            }
        };
        let Some(next) = next else {
            return;
        };
        if on_changed(next).is_err() {
            set_worker_error(
                &last_error,
                IpcError::new(
                    "COUNTER_EVENT_FAILED",
                    "计数器状态已更新，但变更通知未能送达。",
                    true,
                ),
            );
            return;
        }
    }
}

fn set_worker_error(target: &Mutex<Option<IpcError>>, error: IpcError) {
    if let Ok(mut last_error) = target.lock() {
        *last_error = Some(error);
    }
}

#[tauri::command]
pub fn counter_probe_snapshot(probe: tauri::State<'_, CounterProbe>) -> IpcResult<CounterSnapshot> {
    probe.snapshot()
}

#[tauri::command]
pub fn counter_probe_enable(
    app: tauri::AppHandle,
    probe: tauri::State<'_, CounterProbe>,
) -> IpcResult<CounterSnapshot> {
    probe.enable(Arc::new(move |snapshot| {
        use tauri::Emitter;
        app.emit(COUNTER_CHANGED_EVENT, snapshot).map_err(|_| ())
    }))
}

#[tauri::command]
pub fn counter_probe_disable(
    app: tauri::AppHandle,
    probe: tauri::State<'_, CounterProbe>,
) -> IpcResult<CounterSnapshot> {
    probe.disable(Arc::new(move |snapshot| {
        use tauri::Emitter;
        app.emit(COUNTER_CHANGED_EVENT, snapshot).map_err(|_| ())
    }))
}

#[cfg(test)]
mod tests {
    use super::{CounterProbe, CounterSnapshot, IpcError};
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::thread;
    use std::time::{Duration, Instant};

    fn handler() -> Arc<dyn Fn(CounterSnapshot) -> Result<(), ()> + Send + Sync> {
        Arc::new(|_| Ok(()))
    }

    #[test]
    fn snapshots_use_camel_case_and_changed_values_advance_revision() {
        let probe = CounterProbe::new();
        let events = Arc::new(AtomicUsize::new(0));
        let event_count = Arc::clone(&events);
        let on_changed = Arc::new(move |_: CounterSnapshot| {
            event_count.fetch_add(1, Ordering::AcqRel);
            Ok(())
        });

        let initial = probe.enable(on_changed.clone()).unwrap();
        thread::sleep(Duration::from_millis(260));
        let latest = probe.snapshot().unwrap();
        assert!(latest.revision > initial.revision);
        assert!(latest.value >= 1);
        assert!(events.load(Ordering::Acquire) >= 1);
        assert!(serde_json::to_string(&latest)
            .unwrap()
            .contains("instanceId"));

        let stopped = probe.disable(on_changed).unwrap();
        assert!(!stopped.enabled);
        assert!(stopped.revision > latest.revision);
    }

    #[test]
    fn enabling_twice_is_idempotent_and_disable_joins_the_worker() {
        let probe = CounterProbe::new();
        let first = probe.enable(handler()).unwrap();
        let second = probe.enable(handler()).unwrap();
        assert_eq!(first.instance_id, second.instance_id);
        assert_eq!(probe.active_worker_count(), 1);

        let started = Instant::now();
        probe.disable(handler()).unwrap();
        assert!(started.elapsed() < Duration::from_millis(250));
        assert_eq!(probe.active_worker_count(), 0);
    }

    #[test]
    fn one_hundred_enable_disable_cycles_leave_no_worker_and_rotate_instance_id() {
        let probe = CounterProbe::new();
        let mut instances = HashSet::new();
        for _ in 0..100 {
            let enabled = probe.enable(handler()).unwrap();
            assert!(enabled.enabled);
            instances.insert(enabled.instance_id);
            let disabled = probe.disable(handler()).unwrap();
            assert!(!disabled.enabled);
            assert_eq!(probe.active_worker_count(), 0);
        }
        assert_eq!(instances.len(), 100);
    }

    #[test]
    fn event_delivery_failures_return_a_structured_error_after_cleanup() {
        let probe = CounterProbe::new();
        let failed_handler = Arc::new(|_: CounterSnapshot| Err(()));
        probe.enable(failed_handler.clone()).unwrap();
        thread::sleep(Duration::from_millis(180));
        let result = probe.disable(failed_handler);
        assert_eq!(probe.active_worker_count(), 0);
        let error: IpcError = result.unwrap_err();
        assert_eq!(error.code, "COUNTER_EVENT_FAILED");
        assert!(error.retryable);
        assert!(!error.message.is_empty());
    }
}
